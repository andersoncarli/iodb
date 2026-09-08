/** JSON adapter (default) */
const json = {
  ext: '.json',
  to: (v) => JSON.stringify(v, null, 2),
  from: JSON.parse,
}
export default json
