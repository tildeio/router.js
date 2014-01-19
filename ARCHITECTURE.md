## [router.js](https://github.com/tildeio/router.js) Architecture

Let this serve as a guide for anyone who'd like to dig into router.js's
internals, understand what's going on, and hopefully contribute!

## Scope of router.js (et al)
 
`router.js` is most popularly known as the routing microlib used by the
Ember.js Router, though other folk have been known to use it beyond
Ember, including some Angular folk who weren't satisfied with 
[ui-router](https://github.com/angular-ui/ui-router).

`router.js` itself consumes another microlib called 
[route-recognizer](https://github.com/tildeio/route-recognizer).
The division of responsibilities of these three libs is as follows:

### `route-recognizer`

`route-recognizer` is an engine for both parsing/generating URLs
into/from parameters; it can take a URL like "articles/123/comments"
and parse out the parameter `{ article_id: "123" }`, and it can take
`{ article_id: "123" }` and a route descriptor like
"articles/:article_id/comments" and generate "articles/123/comments"

### `router.js`

`router.js` adds the concept of transitions to `route-recognizer`'s
URL parsing engine. Transitions can be URL-initiated (via browser
navigation) or can be directly initiated via route name 
(e.g. `transitionTo('articles', articleObject)`). `router.js`
manages a complex chain of promises involved in the asynchronous
resolution of all the model objects that needed to be loaded in order
to enter a route, e.g. to navigate to "articles/123/comments/2", both
a promise for the article route and for the comments route will need
to be fulfilled in order for that transition to succeed.

### `Ember Router`

The Ember Router adds a DSL for declaring your app's routes, and
defines, among other things, an API for the `Ember.Route` class
that handles much of the heavy lifting and intelligent defaults
for rendering a route's templates, loading data into controllers,
etc.
  
## Scope of router.js (continued)

So `router.js` contains no code responsible for parsing URLs, nor does
it contain any code that depends on Ember's object models (so everything
you'll be dealing with in router.js is just POJOs -- Plain Ol'
JavaScript Objects). 

## Architecture of router.js

`router.js` has gone through a few iterations of refactors over the last
year. Originally it was proud of being lightweight but skimped on
important features for managing promises and asynchrony, then in July
2013 it got a Facelift that supercharged it with promise-awareness and
powerful tools for managing asynchrony. And more recently (Jan 2014), it got a
major refactor to rethink the primitives involved in solving a multitude
of tricky corner cases, in particular:

1. We want to avoid running `model` hooks (the promise-aware hooks 
   responsible for fetching data needed to enter a route) for unchanged
   parent routes shared between source and destination routes.
2. We need this mechanism/algorithm to also work when redirecting
   elsewhere in the middle of another transition, e.g. during a
   transition to "articles/123/comments/2" you redirect to 
   "articles/123/comments/3" after resolving Article 123 and you want to
   avoid re-running the hooks to load Article 123 again.
3. We need this mechanism/algorithm to be smart enough to handle the
   two different approaches to transitions: URL based (where a url is
   parsed into route parameters that are used to load all the data
   needed to enter a route, e.g. `{ article_id: 123 }`, and direct
   named transition-based, where a route name and any context objects
   are provided (e.g. `transitionTo('article', articleObject)`), and the
   provided context object(s) might be promises that can't be serialized
   into URL params until they've fulfilled. 

There are other considerations, but these challenges were largely
responsible for previous stabs at implementation becoming ugly and
unmaintainably bloated, and I was unable to keep all the pieces together
to address various corner cases and bugs that folk were reporting.

The major theme of this refactor has been converting giant spaghetti
functions into classes/objects with a testable, low-level focus (what a
novel concept), and these classes are as follows:

## Classes

### HandlerInfo

A `HandlerInfo` is an object that contains/describes the state of a
route handler. For example, the "foo/bar" URL most likely breaks down
into a hierachy of two handlers, the "foo" handler, and the "bar"
handler. A "handler" is just an object that defines hooks
that `router.js` will call in the course of a transition, e.g. `model`,
`beforeModel`, `setup`, etc. (in Ember.js, these handlers 
are instances of `Ember.Route`). A `HandlerInfo` contains state as to
what that handler's context/model object is (e.g. `articleObject`), 
or the URL parameters associated with the current state of that
handler (e.g. `{ article_id: '123' }`).

Because router.js allows you to reuse handlers between different routes
and route hierarchies, we need this concept of `HandlerInfo`s to
describe the state of each route hierarchy, even if the handlers
themselves are reused. 

`HandlerInfo` is a top-level class, of which there are 3 subclasses

- `UnresolvedHandlerInfoByParam`: a `HandlerInfo` that has URL params
  stored on it which it can use to resolve itself (by calling the
  handler's `beforeModel/model/afterModel` hooks).
- `UnresolvedHandlerInfoByObject`: a `HandlerInfo` that has been
  provided a context object (but no URL params) that it can use to
  resolve itself and serialize into URL params once this object
  has fulfilled (if it's a promise).
- `ResolvedHandlerInfo`: an already-resolved `HandlerInfo` that
  has already calculated/resolved its URL params and context/model object.

The `HandlerInfo`'s public API consists only of a `resolve` method
which will fire all of the various `model` hooks and ultimately resolve
with a `ResolvedHandlerInfo` object. The `ResolvedHandlerInfo`'s
`resolve` method is implemented to just return a promise that fulfills 
with itself.

fwiw: What used to live in a bloated function called `validateEntry` now lives
in the `resolve` method of `HandlerInfo`.

### TransitionState

The `TransitionState` object consists of an array of `HandlerInfo`s
(though more might be added to it; not sure yet).

It too has a public API consisting only of a `resolve` method that
will loop through all of its `HandlerInfo`s, swapping unresolved
`HandlerInfo`s with `ResolvedHandlerInfo`s as it goes.

Both instances of `Router` and `Transition` contain `TransitionState`
properties, which is useful since, depending on whether or not there is
a currently active transition, the "starting point" of a transition
might be the router's current hierarchy of `ResolvedHandlerInfo`s, or it
might be a transition's hierachy of `ResolvedHandlerInfo`s mixed with
unresolved HandlerInfos.

### TransitionIntent

A `TransitionIntent` describes either an attempt to transition via URL
or by named transition (via its subclasses `URLTransitionIntent`
and `NamedTransitionIntent`). There is no state stored on these objects
other than what is needed to describe a transition attempt; a
`URLTransitionIntent` contains only a `url` property, and a
`NamedTransitionIntent` contains only a target route `name` and 
`contexts` array property. 

This class defines only one method `applyToState` which takes an
instance of `TransitionState` and "plays" this `TransitionIntent` on top
of it to generate and return a new instance of `TransitionState` that
contains a combination of resolved and unresolved `HandlerInfo`s. This
is where much of the power of this latest refactor lies;
`TransitionIntent`s don't care whether the provided state comes from a
router or a currently active transition; whatever you provide it, both
subclasses of `TransitionIntent`s are smart enough to spit out a
`TransitionState` containing `HandlerInfo`s that still need to be
resolved in order to complete a transition. Much of the messy logic that
used to live in `paramsForHandler`/`getMatchPoint` now live way less
messily in the `applyToState` methods. 

This also makes it easy to detect corner cases like no-op transitions --
if the returned `TransitionState` consists entirely of
`ResolvedHandlerInfo`s, there's no need to fire off a transition.
It also simplifies things like redirecting into a child route without
winding up in some infinite loop on the parent route hook that's doing
the redirecting.

This also facilitates a healthier approach to
`Transition#retry`; rather than a ton of special cased logic to handle
all the different ways a transition can be kicked off, all that needs to
happen to retry a transition is for a transition to provide its `intent`
property to the transitioning function used by `transitionTo`,
`handleURL`, etc., and that function will make the right choice as to
the correct `TransitionState` to pass to the intent's `applyToState`
method. 

This approach is also used to implement `Router#isActive`; rather than some
brute force approach, one can test if a destination route is active by constructing
a `TransitionIntent`, applying it to the router's current state, and returning true
if all of the `HandlerInfo`s are already resolved.

