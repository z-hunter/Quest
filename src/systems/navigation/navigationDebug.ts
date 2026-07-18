/**
 * Emits concise movement diagnostics without coupling navigation code to the
 * concrete Console class. Kept behind an explicit runtime flag because route
 * planning and collision checks can be frequent during NPC activity.
 */
export function traceNavigation(
  game: unknown,
  stage: string,
  details: Record<string, unknown> = {}
): void {
  const debugConsole = (game as any)?.console;
  if (!debugConsole?.parserPeekNavEnabled) return;

  const body = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  const message = `--- PM NAV TRACE ---\n${stage}${body}`;
  if (typeof debugConsole.logDebug === 'function') {
    debugConsole.logDebug(message);
  } else if (typeof debugConsole.log === 'function') {
    debugConsole.log(message, 'info');
  }
}
