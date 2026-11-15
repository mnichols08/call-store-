// One JSON object per line on stdout (stderr for errors), the shape log shippers expect. Request
// lines are off unless asked for, so tests and local runs stay quiet.
export function createLogger({ requests = false, out = (line) => process.stdout.write(`${line}\n`), err = (line) => process.stderr.write(`${line}\n`) } = {}) {
  const emit = (stream, level, msg, fields) => stream(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }));
  return {
    requests,
    info: (msg, fields = {}) => emit(out, 'info', msg, fields),
    warn: (msg, fields = {}) => emit(err, 'warn', msg, fields),
    error(msg, error, fields = {}) {
      emit(err, 'error', msg, { ...fields, error: error?.message ?? String(error ?? ''), stack: error?.stack?.split('\n').slice(0, 6).join('\n') });
    },
  };
}
