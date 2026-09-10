import { parse, stringify } from 'yaml'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { LogCollection } from '../collection-base.js'

const yamlFmt = (filePath) => {
  return {
    logPath: null,   // Minimality: no history for naked .yaml
    indexPath: null,
    type: 'yaml',
    sep: '/',
    formatLine: (key, patch) => JSON.stringify({ [key]: patch }),
    parseLine: (line) => JSON.parse(line),
    extractFromBuffer: () => null,
    syncFile: (fp, cache) => writeFileSync(fp, stringify(cache, { collectionStyle: 'block', indent: 2 })),
    loadFile: (fp) => (fp && existsSync(fp)) ? (parse(readFileSync(fp, 'utf8')) || {}) : {},
  }
}

export const extensions = ['yaml', 'yml']
export const YamlCollection = (filePath) => LogCollection(filePath, yamlFmt(filePath))
export default YamlCollection
