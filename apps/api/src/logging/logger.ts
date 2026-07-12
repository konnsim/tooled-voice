import type { Logger } from '../tools/define-tool.js';
const sanitize = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).filter(([key]) => !/authorization|token|secret|credential/i.test(key)));
export const logger: Logger = {
  info(data, message) { console.info(JSON.stringify({ level:'info', message, ...sanitize(data) })); },
  error(data, message) { console.error(JSON.stringify({ level:'error', message, ...sanitize(data) })); },
};
