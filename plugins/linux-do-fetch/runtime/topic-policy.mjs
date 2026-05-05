export default class TopicPolicy {
  static ANNOUNCEMENT_WORDS = ["公告", "置顶", "站务公告", "版规", "活动预告"];

  static normalizeTitle(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/[\s\-_.,，。!?！？:：;；"'`~()[\]{}<>《》【】|\\/]+/g, "")
      .trim();
  }

  static isAnnouncementTopic(topic) {
    const title = String(topic?.title || "");
    if (topic?.archetype && topic.archetype !== "regular") return true;
    return TopicPolicy.ANNOUNCEMENT_WORDS.some((w) => title.includes(w));
  }

  static score(topic) {
    const now = Date.now();
    const ageHours = Math.max(0, (now - new Date(topic?.created_at || now).getTime()) / 3600000);
    const likeCount = Number(topic?.like_count || topic?.op_like_count || 0);
    const replyCount = Number(topic?.reply_count || topic?.posts_count || 0);
    const views = Number(topic?.views || 0);
    const freshness = Math.max(0, 40 - ageHours * 1.2);
    const interaction = likeCount * 1.2 + replyCount * 1.8;
    const viewBonus = views >= 10000 ? 20 : views >= 3000 ? 10 : views >= 1000 ? 5 : 0;
    return Math.round(freshness + interaction + viewBonus);
  }
}
