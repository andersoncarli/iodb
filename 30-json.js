import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { LogCollection } from './collection-base.js'

const jsonFmt = (filePath) => {
  return {
    logPath: null, 
    indexPath: null,
    type: 'json',
    sep: '/',
    formatLine: (key, patch) => JSON.stringify({ [key]: patch }),
    parseLine: (line) => JSON.parse(line),
    extractFromBuffer: () => null,
    syncFile: (fp, cache) => writeFileSync(fp, JSON.stringify(cache, null, 2)),
    loadFile: (fp) => {
      if (fp && existsSync(fp) && statSync(fp).isFile()) {
        const c = readFileSync(fp, 'utf8');
        return (JSON.parse(c) || {});
      }
      return {};
    },
  }
}

export const extensions = ['json']
export const JsonCollection = (filePath) => LogCollection(filePath, jsonFmt(filePath))
export default JsonCollection
