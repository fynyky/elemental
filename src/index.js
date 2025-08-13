/* eslint-env browser */

// Provides a function `el` that enables a declarative syntax for DOM generation
// in plain javascript. The first argument is what type of element to create.
// The subsequent arguments are appended as child nodes. If the "child" argument
// is a function, it is executed in the context of the parent node.

// By nesting `el` calls we have a plain javascript alternative to HTML that
// also allows for inline logic. This unifies the DOM and closure hierarchy,
// creating a single consistent context for UI creation.

// When an Observer from reactor.js is passed as a child argument, it's return
// is automatically attached to the parent each time the observer triggers,
// replacing the previous iterations if any. Attached Observers are also
// automatically disabled when their parent element is removed from the DOM.

import { Observer, shuck } from 'reactorjs'

// Manually updated list of valid HTML tags
// Used to know when to create a named tag and when to create a div by default
const VALID_HTML_TAGS = Object.freeze([
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

// Maps normal Elements to their elInterface which enables the magic
// Used to stop the observers when disconnected from the document
const elCache = new WeakMap()

// Setup a mutation observer
// If an element is removed from the document then turn it off
// Have to account for nodes being added to removed outside of the document
const documentObserver = new MutationObserver((mutationList, mutationObserver) => {
  try {
    // Compile a flat set of added/removed elements
    const addedAndRemovedElements = new Set()
    for (const mutationRecord of mutationList) {
      for (const addedNode of Array.from(mutationRecord.addedNodes)) {
        if (addedNode.nodeType === Node.ELEMENT_NODE) {
          addedAndRemovedElements.add(addedNode)
        }
      }
      for (const removedNode of Array.from(mutationRecord.removedNodes)) {
        if (removedNode.nodeType === Node.ELEMENT_NODE) {
          addedAndRemovedElements.add(removedNode)
        }
      }
    }
    // Do stuff to the nodes
    for (const mutatedElement of addedAndRemovedElements) {
      subtreeDo(mutatedElement, (element) => {
        const elementElInterface = elCache.get(element)
        if (elementElInterface) {
          if (document.contains(element)) {
            for (const obs of elementElInterface.observers) {
              try {
                obs.start()
              } catch (error) {
                console.warn('Failed to start observer:', error)
              }
            }
          } else {
            for (const obs of elementElInterface.observers) {
              try {
                obs.stop()
              } catch (error) {
                console.warn('Failed to stop observer:', error)
              }
            }
          }
        }
      })
    }
  } catch (error) {
    console.error('Error in document mutation observer:', error)
  }
})
documentObserver.observe(document, { subtree: true, childList: true })

// Tracks when observer comment placeholders are removed
// When they are remove their partner as well and deactivate their observer
// Maps the observer start end and observer itself to each other
const observerTrios = new WeakMap()
const commentObserver = new MutationObserver((mutationList, mutationObserver) => {
  try {
    for (const mutationRecord of mutationList) {
      for (const removedNode of Array.from(mutationRecord.removedNodes)) {
        try {
          observerTrios.get(removedNode)?.clear()
        } catch (error) {
          console.warn('Failed to clear observer trio:', error)
        }
      }
    }
  } catch (error) {
    console.error('Error in comment mutation observer:', error)
  }
})

// Helper function to do things to all elements in a subtree
function subtreeDo (target, callback) {
  if (!(target instanceof Element)) {
    throw new TypeError(
      'target is not an instance of Element'
    )
  }
  if (!(typeof callback === 'function')) {
    throw new TypeError(
      'callback is not a function'
    )
  }
  const descendents = target.getElementsByTagName('*')
  callback(target)
  for (const descendent of descendents) callback(descendent)
}

// Helper function to get all nodes between 2 nodes
function getNodesBetween (startNode, endNode) {
  if (
    startNode.parentNode === null ||
    endNode.parentNode === null ||
    startNode.parentNode !== endNode.parentNode
  ) throw new RangeError('endNode could not be reached from startNode')
  const result = []
  let currentNode = startNode.nextSibling
  while (currentNode !== endNode) {
    if (currentNode === null) {
      throw new RangeError('endNode could not be reached from startNode')
    }
    result.push(currentNode)
    currentNode = currentNode.nextSibling
  }
  return result
}

// Simple check for a query selector over creating a tag
// Problem is that a plain text string is a valid tag search
// We check for the common cases of . # and [
// Just skip starting with tag search
// TODO consider if there are better ways to do this
const isQuerySelector = (testString) => (
  typeof testString === 'string' && (
    testString.startsWith('.') ||
    testString.startsWith('#') ||
    testString.startsWith('[')
  )
)

// Main magic element wrapping function
// First argument is the element to create or wrap
// Subsequent arguments are children to attach
// Returns the element with all the stuff attached
export const el = (descriptor, ...children) => {
  // Create the new element or wrap an existing one
  // If its an existing element dont do anything
  let self
  // Trivial case when given an element
  if (descriptor instanceof Element) {
    self = descriptor
  // If its a selector then find the thing
  } else if (isQuerySelector(descriptor)) {
    self = document.querySelector(descriptor)
  // If its a valid html tag, then make a new html tag and add classes
  // Default to div otherwise
  } else if (typeof descriptor === 'string') {
    const firstWord = descriptor.split(' ')[0]
    const tag = VALID_HTML_TAGS.includes(firstWord) ? firstWord : 'div'
    const newElement = document.createElement(tag)
    newElement.className = descriptor
    self = newElement
  } else {
    throw new TypeError('el descriptor expects string or existing Element')
  }

  // Now that we know who we are
  // See if there's already a wrapper
  // Place to store el specific properties and methods
  // without polluting the Element
  let elInterface = elCache.get(self)
  if (typeof elInterface === 'undefined') {
    elInterface = {
      // Map of observers to a Set of elements they create
      // Should this be weakrefmap?
      observers: new Set()
    }
    elCache.set(self, elInterface)
  }
  commentObserver.observe(self, { subtree: false, childList: true })

  // For the children
  // If it's a string, append it as a text node
  // If it's an Element or DocumentFragment, append it directly
  // If it's an iterable (array), recursively append each child
  // If it's a Promise, create a placeholder and resolve it asynchronously
  // If it's a function, execute it in the element's context and append return values
  // If it's an Observer, create bookend comments and handle it like a reactive function
  // If it's none of the above, throw a TypeError
  // TODO: Consider failure strategy. Fail fast or fail forward
  // Currently we fail fast. The idea is to be simple syntactic sugar with minimal inner workings
  // We could fail forward instead, dropping the failed children and continuing with the rest
  // This would be more robust, but would be more complex to reason about
  // For example with arrays, we fail fast so upon a malformed child we halt and don't append the rest of the array
  // We could fail forward by catching errors and appending the rest of the array without the malformed child
  function append (child, insertionPoint) {
    // If the insertion point given is no longer attached
    // Then abort the insertion
    if (insertionPoint && insertionPoint.parentElement !== self) {
      throw new Error('Append insertion point is no longer attached to the element')
    }
    // Null case is just skipped with no error
    if (typeof child === 'undefined' || child === null) {
      return
    // Strings are just appended as text
    } else if (typeof child === 'string') {
      const textNode = document.createTextNode(child)
      self.insertBefore(textNode, insertionPoint)
      return
    // Existing elements are just appended
    } else if (child instanceof Element || child instanceof DocumentFragment) {
      self.insertBefore(shuck(child), insertionPoint)
      return
    // Promises get an immediate placeholder before they resolve
    // If the placeholder is removed before the promise resolves. Nothing happens
    // With observers, this means only the latest promise will get handled
    } else if (child instanceof Promise) {
      const promisePlaceholder = document.createComment('promisePlaceholder')
      self.insertBefore(promisePlaceholder, insertionPoint)
      child.then(value => {
        append(value, promisePlaceholder)
      }).finally(() => {
        promisePlaceholder.remove()
      })
      return
    // Observers work similarly to functions
    // but with comment "bookends" on to demark their position
    // On initial commitment. Observers work like normal functions
    // On subsequent triggers. Observers first clear everything
    // between bookends
    } else if (child instanceof Observer) {
      elInterface.observers.add(child)
      // Start with the bookends marking the observer domain
      const observerStartNode = document.createComment('observerStart')
      const observerEndNode = document.createComment('observerEnd')
      self.insertBefore(observerStartNode, insertionPoint)
      self.insertBefore(observerEndNode, insertionPoint)
      // Keep a mapping of the bookends to the observer
      // Lets the observer be cleaned up when the owning comment is removed
      const observerTrio = {
        start: observerStartNode,
        end: observerEndNode,
        observer: child,
        clear: function () {
          this.start.remove()
          this.end.remove()
          this.observer.stop()
          // TODO: consider whether I should map and remove the meta observer instead
          elInterface.observers.delete(this.observer)
        }
      }
      observerTrios.set(observerStartNode, observerTrio)
      observerTrios.set(observerEndNode, observerTrio)
      observerTrios.set(child, observerTrio)

      // Observe the observer to append the results
      // Check if the bookmarks are still attached before acting
      // Clear everything in between the bookmarks (including other observers)
      // Then insert new content between them
      new Observer(() => {
        const result = child.value
        if (observerStartNode.parentNode === self && observerEndNode.parentNode === self) {
          const oldChildren = getNodesBetween(observerStartNode, observerEndNode)
          for (const oldChild of oldChildren) {
            oldChild.remove()
            observerTrios.get(oldChild)?.clear()
          }
          append(result, observerEndNode)
        }
      }).start()
      // Kickoff the observer with a context of self
      child.setThisContext(self)
      child.setArgsContext(self)
      child.stop()
      child.start()
      // If it is not yet in the document then stop observer from triggering further
      if (!document.contains(self)) child.stop()
      return
    // Need this to come after cos observers are functions themselves
    // we use call(self, self) to provide this for traditional functions
    // and to provide (ctx) => {...} for arrow functions
    } else if (typeof child === 'function') {
      const result = child.call(self, self)
      append(result, insertionPoint)
      return
    // Arrays are handled recursively
    // Works for any sort of iterable
    } else if (typeof child?.[Symbol.iterator] === 'function') {
      for (const grandChild of child) {
        append(grandChild, insertionPoint)
      }
      return
    // Anything else isn't meant to be appended
    } else {
      throw new TypeError(`Invalid child type: ${typeof child}`)
    }
  }

  // Arguments are treated same as an array`
  append(children)
  // Return the raw DOM element
  // Magic wrapping held in a pocket dimension outside of time and space
  return self
}

// shorthand for attribute setting
// el('foo', attribute('id', 'bar'))
export function attr (attribute, value) {
  return ($) => {
    $.setAttribute(attribute, value)
  }
}

// shorthand for binding
// el('input', attribute('type', 'text'), bind(rx, 'foo'))
export function bind (reactor, key) {
  return ($) => {
    $.oninput = () => { reactor[key] = $.value }
    return new Observer(() => { $.value = reactor[key] })
  }
}

// Shorthand for making new observers
// el('foo', ob(() => {}))
export function ob (x) {
  return new Observer(x)
}

export { Observer, Reactor, hide, batch, shuck } from 'reactorjs'
