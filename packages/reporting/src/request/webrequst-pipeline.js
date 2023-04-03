class PageStore {
  onTabCreated() {}
}

export default class WebrequestPipeline {
  constructor() {
    this.stages = {};
    this.pageStore = new PageStore();
  }
  init() {}
  unload() {}
  async getPageStore() {}
  addPipelineStep(stage, step) {
    if (!this.stages[stage]) {
      this.stages[stage] = [];
    }
    this.stages[stage].push(step);
  }
  removePipelineStep(stage, name) {
    if (!this.stages[stage]) {
      return;
    }
    this.stages[stage].filter((step) => step.name !== name);
  }
  onBeforeRequest() {}
  onBeforeSendHeaders() {}
  onHeadersReceived() {}
}
