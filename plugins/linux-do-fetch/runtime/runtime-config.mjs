export default class RuntimeConfig {
  static DEFAULT_BASE_URL = "https://linux.do";

  /**
   * @param {Record<string, unknown>} config
   */
  constructor(config) {
    this.baseUrl = String(config?.baseUrl || RuntimeConfig.DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxLlmAttempts = 3;
  }
}
