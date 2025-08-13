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
import { getAllComments, getNodesBetween, isQuerySelector, VALID_HTML_TAGS } from './utils.js'

// Mechanism to automatically start and stop observers when elements are added and removed from the DOM
// This avoids leaking "orphan" observers that stay alive updating nodes that no longer are relevant
// Note: MutationObserver is native class and unrelated to reactor.js observers
const docObserver = new MutationObserver((mutationList, mutationObserver) => {
  for (const mutationRecord of mutationList) {
    // Collect all the removed nodes and their observers
    const observersToStop = new Set()
    for (const removedNode of Array.from(mutationRecord.removedNodes)) {
      const comments = getAllComments(removedNode)
      for (const comment of comments) {
        const observer = observerTrios.get(comment)?.observer
        if (observer) observersToStop.add(observer)
      }
    }
    // Collect all the added nodes and their observers
    const observersToStart = new Set()
    for (const addedNode of Array.from(mutationRecord.addedNodes)) {
      const comments = getAllComments(addedNode)
      for (const comment of comments) {
        const observer = observerTrios.get(comment)?.observer
        if (observer) observersToStart.add(observer)
      }
    }
    // Stop before starting incase an observer is added and removed in the same mutation
    for (const observer of observersToStop) observer.stop()
    for (const observer of observersToStart) observer.start()
  }
})
docObserver.observe(document, { subtree: true, childList: true })

// When an observer is attached to an element, a pair of comment nodes are
// created to mark the "location" of the observer within the parent.
// These comments are meant to act as proxies for the observer within the DOM.
// When a comment is removed, so is its partner and the observer they represent
// This defines the MutationObserver but it is only activated on the creation of each `el` element
// This is unlike the docObserver which is activated on the creation of each element
// This is so comment nodes are removed together even when their parent is out of the DOM
const observerTrios = new WeakMap()
const bookmarkObserver = new MutationObserver((mutationList, mutationObserver) => {
  for (const mutationRecord of mutationList) {
    for (const removedNode of Array.from(mutationRecord.removedNodes)) {
      observerTrios.get(removedNode)?.clear()
    }
  }
})

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
    throw new TypeError('el descriptor expects a String or an Element')
  }
  // Attach the MutationObserver to cleanly remove observer markers
  bookmarkObserver.observe(self, { childList: true })

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
