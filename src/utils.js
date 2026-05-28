/* eslint-env browser */

// Helper function to get all nodes between 2 nodes
export function getNodesBetween (startNode, endNode) {
  if (!(startNode instanceof Node) || !(endNode instanceof Node)) {
    throw new TypeError('getNodesBetween requires a valid DOM Node for startNode and endNode')
  }
  if (
    startNode.parentNode === null ||
    endNode.parentNode === null ||
    startNode.parentNode !== endNode.parentNode
  ) {
    throw new Error('endNode could not be reached from startNode')
  }
  const result = []
  let currentNode = startNode.nextSibling
  while (currentNode !== endNode) {
    if (currentNode === null) {
      throw new Error('endNode could not be reached from startNode')
    }
    result.push(currentNode)
    currentNode = currentNode.nextSibling
  }
  return result
}
