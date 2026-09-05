import { node as nodeFactory } from './node-core.js'
export { SYSTEM, makeNode, SYMBOL, NODE, PATH, METADATA_BAG as META, entityProxy, registerFilePlugins, registerCorePlugins, registerDBPlugin, registerWorkerPlugin, registerTaskPlugin, registerAll, plug, plugRoot, define, transformer, from, _resetPlugins } from './node-core.js'
export const node = nodeFactory
export default node
