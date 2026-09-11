/** The 16-point compass name for a bearing in degrees clockwise from north. */
export function cardinalDirection(degrees: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = ((Math.round(degrees / 22.5) % 16) + 16) % 16;
  return dirs[index];
}
