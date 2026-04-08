/**
 * WhoTracks.Me
 * https://whotracks.me/
 *
 * Copyright 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */

import logger from './logger';
import { random32Bit } from './random';
import { requireParam, requireString } from './utils';
import { BadJobError } from './errors';

import { isLegalVoteCount } from './popularity-estimator';
import {
  sanitizeHostname,
  sanitizePathSegment,
} from './popularity-vote-sanitizer';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/**
 * Processes the results from the PopularityEstimator. These two classes are
 * tightly coupled but with different responsibilities:
 * 1) The PopularityEstimator does all the bookkeeping (all locally)
 *    - it counts visited websites
 *    - in fixed intervals, it picks samples to vote on (e.g. visited a domain)
 * 2) The PopularityVoteHandler prepares the votes (includes network calls):
 *    - masking fields if necessary (using static checks, followed by a quorum request)
 *    - once a vote is ready, it triggers the actual message sending
 */
export default class PopularityVoteHandler {
  constructor({
    jobScheduler,
    communication,
    quorumChecker,
    countryProvider,
    pauseState,
  }) {
    this.jobScheduler = requireParam(jobScheduler);
    this.communication = requireParam(communication);
    this.quorumChecker = requireParam(quorumChecker);
    this.countryProvider = requireParam(countryProvider);
    this.pauseState = pauseState; // optional

    jobScheduler.registerHandler(
      'popularity-estimator:prepare-voting:v1',
      async (job) => {
        const { urlProjection, countType, intervalType, sample } = job.args;
        const validate = (actual, allowed) => {
          if (!allowed.includes(actual)) {
            const options = `[${allowed.join(', ')}]`;
            throw new BadJobError(
              `Job failed check ('${actual}' not in ${options}. Job: ${JSON.stringify(job)})`,
            );
          }
        };
        validate(urlProjection, ['domain', 'hostname', 'hostnamePath']);
        validate(countType, ['visits']);
        validate(intervalType, ['1d', '1w', '4w']);

        // Validate the vote. First structurally ...
        const unmaskedVote = sample?.value;
        const numVotes = sample?.count;
        if (typeof unmaskedVote !== 'string' || !Number.isInteger(numVotes)) {
          throw new BadJobError(
            `Corrupted vote sample in job: ${JSON.stringify(job)}`,
          );
        }

        // ... but also logically. Protect against clients starting to send too many messages.
        if (!isLegalVoteCount({ numVotes, intervalType })) {
          throw new BadJobError(
            `Found too many votes in job (numVotes=${numVotes}): ${JSON.stringify(job)}`,
          );
        }

        const vote = await this.prepareVote(
          urlProjection,
          countType,
          intervalType,
          unmaskedVote,
        );
        logger.info('Vote ready:', `${numVotes}x for`, vote);

        const sendVoteJob = {
          type: 'popularity-estimator:send-vote:v1',
          args: { vote },
          config: {
            readyIn: { min: 2 * SECOND, max: 20 * MINUTE },
          },
        };
        return Array(numVotes).fill(sendVoteJob);
      },
      {
        priority: -100, // preparing the vote can be delayed
        maxJobsTotal: 100,
        cooldownInMs: 4 * SECOND,
      },
    );

    jobScheduler.registerHandler(
      'popularity-estimator:send-vote:v1',
      async (job) => {
        const { vote } = job.args;
        if (!vote) {
          throw new BadJobError(`Vote missing in job ${JSON.stringify(job)}`);
        }

        // It is important here that we send directly and not via the MessageSender.
        // The MessageSender automatically deduplicates message. It most cases, this
        // is want you want but not here. By design, votes can be duplicates;
        // filtering them out would introduce bias.
        await this.communication.send({
          action: 'wtm.popularity',
          payload: vote,
          ver: 3, // Note: no need to keep this number in sync among messages
          'anti-duplicates': random32Bit(),
        });
        logger.info('Voted successfully for:', vote);
      },
      {
        priority: 100, // prioritize sending the final message out
        maxJobsTotal: 100,
        cooldownInMs: 8 * SECOND,
      },
    );

    // (exported for testing only)
    this._sanitizeHostname = sanitizeHostname;
    this._sanitizePathSegment = sanitizePathSegment;
  }

  async prepareVote(urlProjection, countType, intervalType, unmaskedVote) {
    const { hostname: unsafeHostname, path: unsafePath } =
      this._ensureThatVoteIsValid(urlProjection, unmaskedVote);

    const hostname = sanitizeHostname(unsafeHostname);
    const path = unsafePath.map(sanitizePathSegment);

    let vote = [hostname, ...path].join('/');

    // Prepare to include additional information from the adblocker if available.
    // The pause check must use the original hostname: the user pauses real
    // hostnames, not their sanitized form, so passing the masked variant would
    // always report `paused: false` for any hostname that needed sanitization.
    let adblocker;
    if (this.pauseState) {
      adblocker = {
        paused: this.pauseState.isHostnamePaused(unsafeHostname),
        mode: this.pauseState.getFilteringMode(),
      };
    }

    // At this point, the information in the vote should be safe to share.
    // Run an additional quorum check to mask all votes that have not be
    // shared by multiple clients.
    await this.quorumChecker.sendQuorumIncrement({ text: vote });
    const quorumReached = await this.quorumChecker.checkQuorumConsent({
      text: vote,
    });
    if (!quorumReached) {
      logger.info('Vote failed quorum. Discard value:', vote);
      vote = '--';
    }

    const payload = {
      type: {
        urlProjection,
        countType,
        intervalType,
      },
      vote,
      ctry: this.countryProvider.getSafeCountryCode(),
    };
    if (adblocker) {
      payload.adblocker = adblocker;
    }
    return payload;
  }

  _ensureThatVoteIsValid(urlProjection, unmaskedVote) {
    requireString(unmaskedVote);

    switch (urlProjection) {
      case 'domain':
      case 'hostname':
        return {
          hostname: this._validateHostname(unmaskedVote),
          path: [],
        };
      case 'hostnamePath': {
        const [hostname, ...path] = unmaskedVote.split('/');
        return {
          hostname: this._validateHostname(hostname),
          path,
        };
      }
      default:
        throw new BadJobError(
          `Unexpected urlProjection type: ${urlProjection}`,
        );
    }
  }

  _validateHostname(hostname) {
    const hostnameRegex = /^([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/;
    if (!hostnameRegex.test(hostname)) {
      throw new BadJobError(`Invalid hostname: ${hostname}`);
    }
    return hostname;
  }
}
