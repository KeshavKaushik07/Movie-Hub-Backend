import colors from 'colors';

const stamp = () => colors.gray(new Date().toISOString());

export const logger = {
  info: (...a) => console.log(stamp(), colors.cyan('[INFO] '), ...a),
  success: (...a) => console.log(stamp(), colors.green('[OK]   '), ...a),
  ok: (...a) => console.log(stamp(), colors.green('[OK]   '), ...a),
  warn: (...a) => console.warn(stamp(), colors.yellow('[WARN] '), ...a),
  error: (...a) => console.error(stamp(), colors.red('[ERROR]'), ...a),
  debug: (...a) => {
    if (process.env.NODE_ENV !== 'production')
      console.log(stamp(), colors.magenta('[DEBUG]'), ...a);
  },
};

export const statusColor = (status) => {
  if (status >= 500) return colors.red;
  if (status >= 400) return colors.yellow;
  if (status >= 300) return colors.cyan;
  return colors.green;
};

export default logger;
