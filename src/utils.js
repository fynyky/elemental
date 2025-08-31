/* eslint-env browser */

// Manually compiled list of valid HTML tags
export const VALID_HTML_TAGS = Object.freeze([
  'a', 'abbr', 'acronym', 'address', 'applet', 'area', 'article', 'aside', 'audio',
  'b', 'base', 'basefont', 'bdi', 'bdo', 'bgsound', 'big', 'blockquote', 'body', 'br', 'button',
  'canvas', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'command',
  'data', 'datagrid', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'dir', 'div', 'dl', 'dt',
  'em', 'embed', 'eventsource',
  'fieldset', 'figcaption', 'figure', 'font', 'footer', 'form', 'frame', 'frameset',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html',
  'i', 'iframe', 'img', 'input', 'ins', 'isindex',
  'kbd', 'keygen',
  'label', 'legend', 'li', 'link', 'listing',
  'main', 'map', 'mark', 'menu', 'menuitem', 'meta', 'meter',
  'nav', 'noframes', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'param', 'plaintext', 'pre', 'progress',
  'q',
  'ruby', 'rp', 'rt',
  's', 'samp', 'script', 'section', 'select', 'small', 'source', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'tt',
  'u', 'ul',
  'var', 'video',
  'wbr', 'xmp'
])

// Helper function to get all comment nodes for a given subtree
export function getAllComments (root) {
  if (!(root instanceof Node)) {
    throw new TypeError('getAllComments requires a valid DOM Node')
  }
  const commentIterator = document.createNodeIterator(
    root,
    NodeFilter.SHOW_COMMENT,
    () => NodeFilter.FILTER_ACCEPT
  )
  const commentList = []
  let nextComment = commentIterator.nextNode()
  while (nextComment !== null) {
    commentList.push(nextComment)
    nextComment = commentIterator.nextNode()
  }
  return commentList
}

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

// Helper function to check if a string should be used as a css query selector
export function isTreatedAsQuerySelector (testString) {
  if (typeof testString !== 'string' || testString.length === 0) {
    return false
  }
  // Simple test: starts with # or .
  return /^[.#]/.test(testString)
}
