// The ticket keys a space name carries (keep it like the office's KEY_RE), the repository prefixes
// dropped from it, and the Slack-thread bot's label and, when it keeps one, the folder its sessions run in.
export const SPACE_KEY = /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-\d{1,5})(?![0-9])/;
export const REPO_PREFIX = /^(?!)/;
export const THREAD_LABEL = "Slack";
export const THREAD_SESSIONS = null;
