import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export default class StateStore {
  /**
   * @param {string} pluginRoot
   */
  constructor(pluginRoot) {
    this.dataDir = path.join(pluginRoot, "data");
    this.statePath = path.join(this.dataDir, "state.json");
    this.premiumDir = path.join(this.dataDir, "premium");
    this.imageDir = path.join(this.premiumDir, "images");
  }

  async ensureDirs() {
    await mkdir(this.imageDir, { recursive: true });
  }

  async loadState() {
    try {
      const raw = await readFile(this.statePath, "utf8");
      const json = JSON.parse(raw);
      return {
        selectedTopicIds: Array.isArray(json?.selectedTopicIds) ? json.selectedTopicIds.map(String) : [],
        rejectedTopicIds: Array.isArray(json?.rejectedTopicIds) ? json.rejectedTopicIds.map(String) : []
      };
    } catch {
      return { selectedTopicIds: [], rejectedTopicIds: [] };
    }
  }

  async saveState(state) {
    const payload = {
      selectedTopicIds: [...new Set((state?.selectedTopicIds || []).map(String))],
      rejectedTopicIds: [...new Set((state?.rejectedTopicIds || []).map(String))],
      updatedAt: new Date().toISOString()
    };
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.statePath, JSON.stringify(payload, null, 2), "utf8");
  }
}
