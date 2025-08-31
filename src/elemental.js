/* eslint-env browser */

// Elemental
//
// Provides a function `el` that enables a declarative syntax for DOM generation
// in plain JavaScript. The first argument specifies the element to create,
// and subsequent arguments are appended as children.
//
// When a child argument is a function, it's executed in the context of the parent node.
// By nesting `el` calls, we have a plain JavaScript alternative to HTML that allows for inline logic,
// unifying the DOM and closure hierarchy.
//
// By using Reactor.js, we can also have reactive components.
// When an Observer is passed as a child, it initially renders its content like a normal function.
// On subsequent updates, it clears the old content and inserts the new content.
// This enables automatic UI updates when the underlying data changes.

import { Observer, shuck, hide } from 'reactorjs'
import { getAllComments, getNodesBetween, isTreatedAsQuerySelector, VALID_HTML_TAGS } from './utils.js'

// Automatically start/stop observers when elements are added/removed from the DOM.
// This prevents "orphan" observers from staying alive and updating nodes that are no longer relevant.
// Note: MutationObserver is native browser class and unrelated to reactor.js Observers
const docObserver = new MutationObserver((mutationList, mutationObserver) => {
  for (const mutationRecord of mutationList) {
    // Collect all removed observer nodes
    const observersToStop = new Set()
    for (const removedNode of Array.from(mutationRecord.removedNodes)) {
      const comments = getAllComments(removedNode)
      for (const comment of comments) {
        const observer = observerGroups.get(comment)?.observer
        if (observer) observersToStop.add(observer)
      }
    }
    // Collect all added observer nodes
    const observersToStart = new Set()
    for (const addedNode of Array.from(mutationRecord.addedNodes)) {
      const comments = getAllComments(addedNode)
      for (const comment of comments) {
        const observer = observerGroups.get(comment)?.observer
        if (observer) observersToStart.add(observer)
      }
    }
    // Stop before starting in case an observer is added and removed in the same mutation
    for (const observer of observersToStop) observer.stop()
    for (const observer of observersToStart) observer.start()
  }
})
docObserver.observe(document, { subtree: true, childList: true })

// Observer management system using comment nodes as markers.
// When an observer is attached to an element, a pair of comment nodes are created
// to mark the observer's "location" within the parent. These comments act as
// proxies for the observer within the DOM. When either comment is removed, both
// are removed along with the observer they represent.
const observerGroups = new WeakMap()

// Clean up observer markers when comment nodes are removed.
// This ensures proper cleanup of observer resources when DOM changes occur.
// This MutationObserver is attached to each element created by el instead of the document
// so that we can clean up observer markers even when the element is removed from the DOM
const bookmarkObserver = new MutationObserver((mutationList, mutationObserver) => {
  for (const mutationRecord of mutationList) {
    for (const removedNode of Array.from(mutationRecord.removedNodes)) {
      observerGroups.get(removedNode)?.clear()
    }
  }
})

// Main exported function. Creates a DOM element and appends children to it.
//
// @param {string|Element} descriptor - Tag/class string, CSS selector, or an existing Element.
//   - If a string matches a tag or class, creates a new element with those classes.
//   - If a string looks like a selector, finds and uses the existing element in the document.
//   - If an Element is provided, uses it directly.
//
// @param {...(string|Element|Function|Observer|Promise|Iterable)} children - Child nodes to append.
//   - Strings become text nodes.
//   - Elements are appended directly.
//   - Functions are called (with the parent as context) and their return value is appended.
//   - Observers are called like Functions initially but subsequent triggers will replace the old content.
//   - Promises will insert a placeholder and replace it when the promise resolves.
//   - Iterables are looped over and each item is appended.
//
// @returns {Element} The resulting element with all children attached.
export const el = (descriptor, ...children) => {
  // Setup the root element
  let self
  // Trivial case: just use the given element
  if (descriptor instanceof Element) {
    self = descriptor
  // If it looks like a selector try to find the existing element
  } else if (isTreatedAsQuerySelector(descriptor)) {
    self = document.querySelector(descriptor)
    if (!self) {
      throw new Error(`el descriptor selector "${descriptor}" not found`)
    }
  // Create new element from string descriptor
  // If the first word is a valid html tag then use it, otherwise default to div
  // The whole descriptor is added as classes
  // So for example el('h1 foo bar') will create <h1 class="h1 foo bar"></h1>
  } else if (typeof descriptor === 'string') {
    const firstWord = descriptor.split(' ')[0]
    const tag = VALID_HTML_TAGS.includes(firstWord) ? firstWord : 'div'
    const newElement = document.createElement(tag)
    newElement.className = descriptor
    self = newElement
  } else {
    throw new TypeError('el descriptor expects a String or an Element')
  }

  // Attach the MutationObserver to cleanly remove observer sets
  bookmarkObserver.observe(self, { childList: true })

  // Appends a child to the current element.
  // Designed to be called recursively so a function could return a promise which resolves to an array of elements to get appended
  // @param {String|Element|Function|Observer|Promise|Iterable} child - The child to append
  // @param {Node} insertionPoint - Optional point to insert the child before. Defaults to the end of the element.
  function append (child, insertionPoint) {
    // Validate insertion point is still attached
    if (insertionPoint && insertionPoint.parentElement !== self) {
      throw new Error('append insertion point is no longer attached to the element')
    }

    // Ignore null/undefined values
    if (typeof child === 'undefined' || child === null) {
      return
    }

    // Attach strings as text nodes
    if (typeof child === 'string') {
      const textNode = document.createTextNode(child)
      self.insertBefore(textNode, insertionPoint)
      return
    }

    // Attach existing elements and document fragments
    if (child instanceof Element || child instanceof DocumentFragment) {
      self.insertBefore(shuck(child), insertionPoint) // shuck removes any Reactor wrappers
      return
    }

    // Promises get a placeholder node which are replaced when they resolve
    if (child instanceof Promise) {
      const promisePlaceholder = document.createComment('promisePlaceholder')
      self.insertBefore(promisePlaceholder, insertionPoint)

      child.then(value => {
        if (promisePlaceholder.parentElement === self) {
          append(value, promisePlaceholder)
        }
      }).finally(() => {
        if (promisePlaceholder.parentElement === self) {
          promisePlaceholder.remove()
        }
      })
      return
    }

    // Observers get their position marked with a pair of comments
    // Every time the Observer is triggered the content between the comments is replaced
    if (child instanceof Observer) {
      // Create comment markers to define the observer's domain
      // Observe the observer to append the results
      // Check if the bookmarks are still attached before acting
      // Clear everything in between the bookmarks (including other observers)
      // Then insert new content between them
      const observerStartNode = document.createComment('observerStart')
      const observerEndNode = document.createComment('observerEnd')
      const metaObserver = new Observer(() => {
        // Kickoff the observer child with a context of self
        // This needs to be done in the metaObserver to avoid infinite loops
        // If called outside of here, the child could form a dependency on an external observer
        if (observerStartNode.parentNode === self && observerEndNode.parentNode === self) {
          const oldChildren = getNodesBetween(observerStartNode, observerEndNode)
          for (const oldChild of oldChildren) {
            oldChild.remove()
          }
          append(child.value, observerEndNode)
        }
      })
      // Keep a mapping of the bookends to the observer
      // Lets the observer be cleaned up when the owning comment is removed
      const observerGroup = {
        start: observerStartNode,
        end: observerEndNode,
        observer: child,
        metaObserver,
        clear: function () {
          this.start.remove()
          this.end.remove()
          this.observer.stop()
          this.metaObserver.stop()
        }
      }
      observerGroups.set(observerStartNode, observerGroup)
      observerGroups.set(observerEndNode, observerGroup)

      self.insertBefore(observerStartNode, insertionPoint)
      self.insertBefore(observerEndNode, insertionPoint)
      hide(() => child.call(self, self))
      metaObserver.start()
      // If it is not yet in the document then stop observer from triggering further
      if (!document.contains(self)) child.stop()
      return
    }

    // Execute functions and append the result
    if (typeof child === 'function') {
      const result = child.call(self, self)
      append(result, insertionPoint)
      return
    }

    // Recursively handle iterables (arrays, etc.)
    if (typeof child?.[Symbol.iterator] === 'function') {
      for (const grandChild of child) {
        append(grandChild, insertionPoint)
      }
      return
    }

    // Anything else is an error
    throw new TypeError(`Invalid child type: ${typeof child}`)
  }

  // Process all children
  append(children)

  // Return the raw DOM element
  // Magic wrapping held in a pocket dimension outside of time and space
  return self
}

// Shorthand function to set attributes on elements.
// Usage: el('div', attr('id', 'myDiv'))
//
// @param {string} attribute - Attribute name
// @param {string} value - Attribute value
// @returns {Function} Function that sets the attribute when called
export function attr (attribute, value) {
  return ($) => {
    $.setAttribute(attribute, value)
  }
}

// Shorthand function to bind input elements to reactor values.
// Usage: el('input', attr('type', 'text'), bind(rx, 'foo'))
//
// @param {Object} reactor - Reactor object containing the value
// @param {string} key - Key in the reactor object
// @returns {Function} Function that sets up two-way binding
export function bind (reactor, key) {
  return ($) => {
    $.oninput = () => { reactor[key] = $.value }
    return new Observer(() => { $.value = reactor[key] })
  }
}

// Shorthand function to create new observers.
// Usage: el('div', ob(() => 'Hello World'))
//
// @param {Function} x - Function to wrap in an observer
// @returns {Observer} New observer instance
export function ob (x) {
  return new Observer(x)
}
