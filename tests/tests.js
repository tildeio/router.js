QUnit.config.testTimeout = 100;

var router, url, handlers;

module("The router", {
  setup: function() {
    router = new Router();

    router.map(function(match) {
      match("/posts", function(match) {
        match("/:id").to("showPost");
        match("/admin/:id").to("admin", function(match) {
          match("/posts").to("adminPosts");
          match("/posts/:post_id").to("adminPost");
        });
        match("/").to("postIndex", function(match) {
          match("/all").to("showAllPosts");

          // TODO: Support canonical: true
          match("/").to("showAllPosts");
          match("/popular").to("showPopularPosts");
          match("/filter/:filter_id").to("showFilteredPosts");
        });
      });
    });

    router.getHandler = function(name) {
      return handlers[name];
    };

    router.updateURL = function() { };
  }
});

test("Mapping adds named routes to the end", function() {
  url = router.recognizer.generate("showPost", { id: 1 });
  equal(url, "/posts/1");

  url = router.recognizer.generate("showAllPosts");
  equal(url, "/posts");
});

test("Handling an invalid URL raises an exception", function() {
  throws(function() {
    router.handleURL("/unknown");
  }, /no route matched/i);
});

function routePath(infos) {
  var path = [];

  for (var i=0, l=infos.length; i<l; i++) {
    path.push(infos[i].name);
  }

  return path.join(".");
}

asyncTest("Handling a URL triggers deserialize on the handler and passes the result into the setup method", function() {
  expect(4);

  var post = { post: true };
  var posts = { index: true };

  var showPostHandler = {
    deserialize: function(params) {
      deepEqual(params, { id: "1" });
      return post;
    },

    setup: function(object) {
      strictEqual(object, post);
      equal(showPostHandler.context, post);
    }
  };

  var postIndexHandler = {};

  handlers = {
    showPost: showPostHandler,
    postIndex: postIndexHandler
  };

  router.didTransition = function(infos) {
    equal(routePath(infos), "showPost");
    start();
  }

  router.handleURL("/posts/1");
});

test("when transitioning with the same context, setup should only be called once", function() {
  var parentSetupCount = 0,
      childSetupCount = 0;

  var context = { id: 1 };

  router = new Router();

  router.map(function(match) {
    match("/").to('index');
    match("/posts/:id").to('post', function(match) {
      match("/details").to('postDetails');
    });
  });

  router.getHandler = function(name) {
    return handlers[name];
  };

  router.updateURL = function() { };

  var indexHandler = { };

  var postHandler = {
    setup: function() {
      parentSetupCount++;
    },

    deserialize: function(params) {
      return params;
    }
  };

  var postDetailsHandler = {
    setup: function() {
      childSetupCount++;
    }
  };

  handlers = {
    index: indexHandler,
    post: postHandler,
    postDetails: postDetailsHandler
  };

  router.handleURL('/');

  equal(parentSetupCount, 0, 'precond - parent not setup');
  equal(childSetupCount, 0, 'precond - parent not setup');

  router.transitionTo('postDetails', context);

  equal(parentSetupCount, 1, 'after one transition parent is setup once');
  equal(childSetupCount, 1, 'after one transition child is setup once');

  router.transitionTo('postDetails', context);

  equal(parentSetupCount, 1, 'after two transitions, parent is still setup once');
  equal(childSetupCount, 1, 'after two transitions, child is still setup once');
});

test("when transitioning to a new parent and child state, the parent's context should be available to the child's deserialize", function() {
  var contexts = [];

  router = new Router();

  router.map(function(match) {
    match("/").to('index');
    match("/posts/:id").to('post', function(match) {
      match("/details").to('postDetails');
    });
  });

  router.getHandler = function(name) {
    return handlers[name];
  };

  router.updateURL = function() { };

  var indexHandler = { };

  var postHandler = {
    deserialize: function(params) {
      return params;
    }
  };

  var postDetailsHandler = {
    name: 'postDetails',
    deserialize: function(params) {
      contexts.push(postHandler.context);
    }
  };

  handlers = {
    index: indexHandler,
    post: postHandler,
    postDetails: postDetailsHandler
  };

  router.handleURL('/');

  // This is a crucial part of the test
  // In some cases, calling `generate` was preventing `deserialize` from being called
  router.generate('postDetails', { id: 1 });

  router.transitionTo('postDetails', { id: 1 });

  deepEqual(contexts, [{ id: 1 }], 'parent context is available');
});

test("A delegate provided to router.js is passed along to route-recognizer", function() {
  router = new Router();

  router.delegate = {
    willAddRoute: function(context, route) {
      if (!context) { return route; }

      if (context === 'application') {
        return route;
      }

      return context + "." + route;
    },

    // Test that both delegates work together
    contextEntered: function(name, match) {
      match("/").to("index");
    }
  };

  router.map(function(match) {
    match("/").to("application", function(match) {
      match("/posts").to("posts", function(match) {
        match("/:post_id").to("post");
      });
    });
  });

  var handlers = [];

  router.getHandler = function(handler) {
    handlers.push(handler);
    return {};
  }

  router.handleURL("/posts");

  deepEqual(handlers, [ "application", "application", "posts", "posts", "posts.index", "posts.index", "loading" ]);
});

asyncTest("Handling a nested URL triggers each handler", function() {
  expect(31);

  var posts = [];
  var allPosts = { all: true };
  var popularPosts = { popular: true };
  var amazingPosts = { filtered: "amazing" };
  var sadPosts = { filtered: "sad" };

  var counter = 0;

  var postIndexHandler = {
    deserialize: function(params) {
      // this will always get called, since it's at the root
      // of all of the routes tested here
      deepEqual(params, {}, "params should be empty in postIndexHandler#deserialize");
      return posts;
    },

    setup: function(object) {
      if (counter === 0) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be set up in postIndexHandler#setup");
        strictEqual(object, posts, "The object passed in to postIndexHandler#setup should be posts");
      } else {
        ok(false, "Should not get here");
      }
    }
  };

  var showAllPostsHandler = {
    deserialize: function(params) {
      if (counter > 0 && counter < 4) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be set up in showAllPostsHandler#deserialize");
      }

      if (counter < 4) {
        deepEqual(params, {}, "params should be empty in showAllPostsHandler#deserialize");
        return allPosts;
      } else {
        ok(false, "Should not get here");
      }
    },

    setup: function(object) {
      if (counter === 0) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be set up in showAllPostsHandler#setup");
        equal(showAllPostsHandler.context, allPosts, "showAllPostsHandler context should be set up in showAllPostsHandler#setup");
        strictEqual(object, allPosts, "The object passed in should be allPosts in showAllPostsHandler#setup");
      } else {
        ok(false, "Should not get here");
      }
    }
  };

  var showPopularPostsHandler = {
    deserialize: function(params) {
      if (counter < 3) {
        ok(false, "Should not get here");
      } else if (counter === 3) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be set up in showPopularPostsHandler#deserialize");
        deepEqual(params, {}, "params should be empty in showPopularPostsHandler#serialize");
        return popularPosts;
      } else {
        ok(false, "Should not get here");
      }
    },

    setup: function(object) {
      if (counter === 3) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be set up in showPopularPostsHandler#setup");
        equal(showPopularPostsHandler.context, popularPosts, "showPopularPostsHandler context should be set up in showPopularPostsHandler#setup");
        strictEqual(object, popularPosts, "The object passed to showPopularPostsHandler#setup should be popular posts");
      } else {
        ok(false, "Should not get here");
      }
    }
  };

  var showFilteredPostsHandler = {
    deserialize: function(params) {
      if (counter < 4) {
        ok(false, "Should not get here");
      } else if (counter === 4) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be set up in showFilteredPostsHandler#deserialize");
        deepEqual(params, { filter_id: 'amazing' }, "params should be { filter_id: 'amazing' } in showFilteredPostsHandler#deserialize");
        return amazingPosts;
      } else if (counter === 5) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be posts in showFilteredPostsHandler#deserialize");
        deepEqual(params, { filter_id: 'sad' }, "params should be { filter_id: 'sad' } in showFilteredPostsHandler#deserialize");
        return sadPosts;
      } else {
        ok(false, "Should not get here");
      }
    },

    setup: function(object) {
      if (counter === 4) {
        equal(postIndexHandler.context, posts);
        equal(showFilteredPostsHandler.context, amazingPosts);
        strictEqual(object, amazingPosts);
      } else if (counter === 5) {
        equal(postIndexHandler.context, posts);
        equal(showFilteredPostsHandler.context, sadPosts);
        strictEqual(object, sadPosts);
        started = true;
      } else {
        ok(false, "Should not get here");
      }
    }
  };

  var started = false;

  // Test that didTransition gets called
  router.didTransition = function(infos) {
    if (started) { start(); }
  }

  handlers = {
    postIndex: postIndexHandler,
    showAllPosts: showAllPostsHandler,
    showPopularPosts: showPopularPostsHandler,
    showFilteredPosts: showFilteredPostsHandler
  };

  router.handleURL("/posts");

  counter++;

  router.handleURL("/posts/all");

  counter++;

  router.handleURL("/posts");

  counter++;

  router.handleURL("/posts/popular");

  counter++;

  router.handleURL("/posts/filter/amazing");

  counter++;

  router.handleURL("/posts/filter/sad");
});

test("it can handle direct transitions to named routes", function() {
  var posts = [];
  var allPosts = { all: true };
  var popularPosts = { popular: true };
  var amazingPosts = { filter: "amazing" };
  var sadPosts = { filter: "sad" };

  postIndexHandler = {
    deserialize: function(params) {
      return allPosts;
    },

    serialize: function(object, params) {
      return {};
    },

    setup: function(object) {

    }
  };

  showAllPostsHandler = {
    deserialize: function(params) {
      deepEqual(params, {});
      return allPosts;
    },

    serialize: function(object, params) {
      return {};
    },

    setup: function(object) {
      strictEqual(object, allPosts, 'showAllPosts should get correct setup');
    }
  };

  showPopularPostsHandler = {
    deserialize: function(params) {
      deepEqual(params, {});
      return popularPosts;
    },

    serialize: function(object) {
      return {};
    },

    setup: function(object) {
      strictEqual(object, popularPosts, "showPopularPosts#setup should be called with the deserialized value");
    }
  };

  showFilteredPostsHandler = {
    deserialize: function(params) {
      if (params.filter_id === "amazing") {
        return amazingPosts;
      } else if (params.filter_id === "sad") {
        return sadPosts;
      }
    },

    serialize: function(object, params) {
      deepEqual(params, ['filter_id'], 'showFilteredPosts should get correct serialize');
      return { filter_id: object.filter };
    },

    setup: function(object) {
      if (counter === 2) {
        strictEqual(object, amazingPosts, 'showFilteredPosts should get setup with amazingPosts');
      } else if (counter === 3) {
        strictEqual(object, sadPosts, 'showFilteredPosts should get setup setup with sadPosts');
      }
    }
  }

  handlers = {
    postIndex: postIndexHandler,
    showAllPosts: showAllPostsHandler,
    showPopularPosts: showPopularPostsHandler,
    showFilteredPosts: showFilteredPostsHandler
  };

  router.updateURL = function(url) {
    expected = {
      0: "/posts",
      1: "/posts/popular",
      2: "/posts/filter/amazing",
      3: "/posts/filter/sad",
      4: "/posts"
    }

    equal(url, expected[counter], 'updateURL should be called with correct url');
  };


  router.handleURL("/posts");

  var counter = 0;

  router.transitionTo("showAllPosts");

  counter++;

  router.transitionTo("showPopularPosts");

  counter++;

  router.transitionTo("showFilteredPosts", amazingPosts);

  counter++;

  router.transitionTo("showFilteredPosts", sadPosts);

  counter++;

  router.transitionTo("showAllPosts");
});

test("it aborts transitioning if a handler's setup returns false", function() {
  expect(2);

  router = new Router();

  router.map(function(match) {
    match("/").to('index');
    match("/posts/").to('posts', function(match) {
      match("/").to('postsIndex', function(match) {
        match("/all").to('allPosts')
      });
    });
  });

  router.getHandler = function(name) {
    return handlers[name];
  };

  router.updateURL = function() { };

  var indexHandler = {
  };

  var postsHandler = {
    enter: function() {
      ok(true, "Posts enter was called");
    },
    setup: function() {
      ok(true, "Posts setup was called");
      return false;
    }
  };

  var postsIndexHandler = {
    enter: function() {
      ok(false, "Should not get here");
    },
    setup: function() {
      ok(false, "Should not get here");
    }
  };

  var allPostsHandler = {
    enter: function() {
      ok(false, "Should not get here");
    },
    setup: function() {
      ok(false, "Should not get here");
    }
  };

  handlers = {
    index: indexHandler,
    posts: postsHandler,
    postsIndex: postsIndexHandler,
    allPosts: allPostsHandler
  };

  router.handleURL('/posts/all');
});

test("replaceWith calls replaceURL", function() {
  var updateCount = 0,
      replaceCount = 0;

  router.updateURL = function() {
    updateCount++;
  }

  router.replaceURL = function() {
    replaceCount++;
  }

  handlers = {
    postIndex: { },
    showAllPosts: { }
  };

  router.handleURL('/posts');

  router.replaceWith('showAllPosts');

  equal(updateCount, 0, "should not call updateURL");
  equal(replaceCount, 1, "should call replaceURL once");
});

asyncTest("if deserialize returns a promise, it enters a loading state", function() {
  var post = { post: true };

  var events = [];

  var showPostHandler = {
    deserialize: function(params) {
      deepEqual(events, []);
      events.push("deserialize");

      var promise = new RSVP.Promise();

      setTimeout(function() {
        promise.resolve(post);
      }, 1);

      return promise;
    },

    setup: function(object) {
      deepEqual(events, ["deserialize", "loading", "loaded"]);
      events.push("setup");

      strictEqual(object, post);
      start();
    }
  }

  router.didTransition = function(infos) {
    equal(routePath(infos), "showPost");
    start();
  };

  var loadingHandler = {
    setup: function() {
      deepEqual(events, ["deserialize"]);
      events.push("loading");
      ok(true, "Loading was called");
    },

    exit: function() {
      deepEqual(events, ["deserialize", "loading"]);
      events.push("loaded");
      ok(true, "Loading was exited");
    }
  }

  handlers = {
    showPost: showPostHandler,
    loading: loadingHandler
  }

  router.handleURL("/posts/1");
});

asyncTest("if deserialize returns a promise that is later rejected, it enters a failure state", function() {
  var post = { post: true };
  var err = { error: true };

  var events = [];

  var showPostHandler = {
    deserialize: function(params) {
      deepEqual(events, []);
      events.push("deserialize");

      var promise = new RSVP.Promise();

      setTimeout(function() {
        promise.reject(err);
      }, 1);

      return promise;
    },

    setup: function(object) {
      deepEqual(events, ["deserialize", "loading", "loaded"]);
      events.push("setup");

      strictEqual(object, post);
    }
  }

  var loadingHandler = {
    setup: function() {
      deepEqual(events, ["deserialize"]);
      events.push("loading");
      ok(true, "Loading was called");
    },

    exit: function() {
      deepEqual(events, ["deserialize", "loading"]);
      events.push("loaded");
      ok(true, "Loading was exited");
    }
  }

  var failureHandler = {
    setup: function(error) {
      start();
      strictEqual(error, err);
    }
  }

  handlers = {
    showPost: showPostHandler,
    loading: loadingHandler,
    failure: failureHandler
  }

  router.handleURL("/posts/1");
});

asyncTest("if deserialize returns a promise that fails in the callback, it enters a failure state", function() {
  var post = { post: true };

  var events = [];

  var showPostHandler = {
    deserialize: function(params) {
      deepEqual(events, []);
      events.push("deserialize");

      var promise = new RSVP.Promise();

      promise.resolve(post);

      return promise;
    },

    setup: function(object) {
      throw 'Setup error';
    }
  }

  var failureHandler = {
    setup: function(error) {
      start();
      strictEqual(error, err);
    }
  }

  handlers = {
    showPost: showPostHandler,
    failure: failureHandler
  }

  router.handleURL("/posts/1");
});

asyncTest("Moving to a new top-level route triggers exit callbacks", function() {
  expect(6);

  var allPosts = { posts: "all" };
  var postsStore = { 1: { id: 1 }, 2: { id: 2 } };
  var currentId, currentURL, currentPath;

  var showAllPostsHandler = {
    deserialize: function(params) {
      return allPosts;
    },

    setup: function(posts) {
      equal(posts, allPosts, "The correct context was passed into showAllPostsHandler#setup");
      currentPath = "postIndex.showAllPosts";

      setTimeout(function() {
        currentURL = "/posts/1";
        currentId = 1;
        router.transitionTo('showPost', postsStore[1]);
      }, 0);
    },

    exit: function() {
      ok(true, "Should get here");
    }
  };

  var showPostHandler = {
    deserialize: function(params) {
      if (postsStore[params.id]) { return postsStore[params.id]; }
      return postsStore[params.id] = { post: params.id };
    },

    serialize: function(post) {
      return { id: post.id };
    },

    setup: function(post) {
      currentPath = "showPost";
      equal(post.id, currentId, "The post id is " + currentId);
    }
  };

  var postIndexHandler = {};

  handlers = {
    postIndex: postIndexHandler,
    showAllPosts: showAllPostsHandler,
    showPost: showPostHandler
  };

  router.updateURL = function(url) {
    equal(url, currentURL, "The url is " + currentURL + " as expected");
  };

  router.didTransition = function(infos) {
    equal(routePath(infos), currentPath);
    start();
  };

  router.handleURL("/posts");
});

test("Moving to the same route with a different parent dynamic segment re-runs deserialize", function() {
  var admins = { 1: { id: 1 }, 2: { id: 2 } },
      adminPosts = { 1: { id: 1 }, 2: { id: 2 } },
      adminPostDeserialize = 0;

  var adminHandler = {
    deserialize: function(params) {
      return this.currentModel = admins[params.id];
    }
  };

  var adminPostsHandler = {
    deserialize: function() {
      adminPostDeserialize++;
      return adminPosts[adminHandler.currentModel.id];
    }
  };

  handlers = {
    admin: adminHandler,
    adminPosts: adminPostsHandler
  }

  router.handleURL("/posts/admin/1/posts");

  equal(adminHandler.context, admins[1]);
  equal(adminPostsHandler.context, adminPosts[1]);

  router.handleURL("/posts/admin/2/posts");
  equal(adminHandler.context, admins[2]);
  equal(adminPostsHandler.context, adminPosts[2]);
});

asyncTest("Moving to a sibling route only triggers exit callbacks on the current route (when transitioned internally)", function() {
  expect(8);

  var allPosts = { posts: "all" };
  var postsStore = { 1: { id: 1 }, 2: { id: 2 } };
  var currentId, currentURL;

  var showAllPostsHandler = {
    deserialize: function(params) {
      return allPosts;
    },

    setup: function(posts) {
      equal(posts, allPosts, "The correct context was passed into showAllPostsHandler#setup");

      setTimeout(function() {
        currentURL = "/posts/filter/favorite";
        router.transitionTo('showFilteredPosts', {
          id: 'favorite'
        });
      }, 0);
    },

    enter: function() {
      ok(true, "The sibling handler should be entered");
    },

    exit: function() {
      ok(true, "The sibling handler should be exited");
    }
  };

  var filters = {};

  var showFilteredPostsHandler = {
    enter: function() {
      ok(true, "The new handler was entered");
    },

    exit: function() {
      ok(false, "The new handler should not be exited");
    },

    deserialize: function(params) {
      var id = params.filter_id;
      if (!filters[id]) {
        filters[id] = { id: id }
      }

      return filters[id];
    },

    serialize: function(filter) {
      equal(filter.id, "favorite", "The filter should be 'favorite'");
      return { filter_id: filter.id };
    },

    setup: function(filter) {
      equal(filter.id, "favorite", "showFilteredPostsHandler#setup was called with the favorite filter");
      start();
    }
  };

  var postIndexHandler = {
    enter: function() {
      ok(true, "The outer handler was entered only once");
    },

    exit: function() {
      ok(false, "The outer handler was not exited");
    }
  };

  handlers = {
    postIndex: postIndexHandler,
    showAllPosts: showAllPostsHandler,
    showFilteredPosts: showFilteredPostsHandler
  };

  router.updateURL = function(url) {
    equal(url, currentURL, "The url is " + currentURL + " as expected");
  };

  router.handleURL("/posts");
});

asyncTest("Moving to a sibling route only triggers exit callbacks on the current route (when transitioned via a URL change)", function() {
  expect(7);

  var allPosts = { posts: "all" };
  var postsStore = { 1: { id: 1 }, 2: { id: 2 } };
  var currentId, currentURL;

  var showAllPostsHandler = {
    deserialize: function(params) {
      return allPosts;
    },

    setup: function(posts) {
      equal(posts, allPosts, "The correct context was passed into showAllPostsHandler#setup");

      setTimeout(function() {
        currentURL = "/posts/filter/favorite";
        router.handleURL(currentURL);
      }, 0);
    },

    enter: function() {
      ok(true, "The sibling handler should be entered");
    },

    exit: function() {
      ok(true, "The sibling handler should be exited");
    }
  };

  var filters = {};

  var showFilteredPostsHandler = {
    enter: function() {
      ok(true, "The new handler was entered");
    },

    exit: function() {
      ok(false, "The new handler should not be exited");
    },

    deserialize: function(params) {
      equal(params.filter_id, "favorite", "The filter should be 'favorite'");

      var id = params.filter_id;
      if (!filters[id]) {
        filters[id] = { id: id }
      }

      return filters[id];
    },

    serialize: function(filter) {
      return { filter_id: filter.id };
    },

    setup: function(filter) {
      equal(filter.id, "favorite", "showFilteredPostsHandler#setup was called with the favorite filter");
      start();
    }
  };

  var postIndexHandler = {
    enter: function() {
      ok(true, "The outer handler was entered only once");
    },

    exit: function() {
      ok(false, "The outer handler was not exited");
    }
  };

  handlers = {
    postIndex: postIndexHandler,
    showAllPosts: showAllPostsHandler,
    showFilteredPosts: showFilteredPostsHandler
  };

  router.updateURL = function(url) {
    equal(url, currentURL, "The url is " + currentURL + " as expected");
  };

  router.handleURL("/posts");
});

asyncTest("events can be targeted at the current handler", function() {
  var showPostHandler = {
    enter: function() {
      ok(true, "The show post handler was entered");
    },

    events: {
      expand: function() {
        equal(this, showPostHandler, "The handler is the `this` for the event");
        start();
      }
    }
  };

  handlers = {
    showPost: showPostHandler
  };

  router.handleURL("/posts/1");
  router.trigger("expand");
});

test("Unhandled events raise an exception", function() {
  var showPostHandler = {};

  handlers = {
    showPost: showPostHandler
  };

  router.handleURL("/posts/1");

  throws(function() {
    router.trigger("doesnotexist");
  }, /doesnotexist/);
});

asyncTest("events can be targeted at a parent handler", function() {
  expect(3);

  var postIndexHandler = {
    enter: function() {
      ok(true, "The post index handler was entered");
    },

    events: {
      expand: function() {
        equal(this, postIndexHandler, "The handler is the `this` in events");
        start();
      }
    }
  };

  var showAllPostsHandler = {
    enter: function() {
      ok(true, "The show all posts handler was entered");
    }
  }

  handlers = {
    postIndex: postIndexHandler,
    showAllPosts: showAllPostsHandler
  };

  router.handleURL("/posts");
  router.trigger("expand");
});

asyncTest("events only fire on the closest handler", function() {
  expect(5);

  var postIndexHandler = {
    enter: function() {
      ok(true, "The post index handler was entered");
    },

    events: {
      expand: function() {
        ok(false, "Should not get to the parent handler");
      }
    }
  };

  var showAllPostsHandler = {
    enter: function() {
      ok(true, "The show all posts handler was entered");
    },

    events: {
      expand: function(passedContext1, passedContext2) {
        equal(context1, passedContext1, "A context is passed along");
        equal(context2, passedContext2, "A second context is passed along");
        equal(this, showAllPostsHandler, "The handler is passed into events as `this`");
        start();
      }
    }
  }

  handlers = {
    postIndex: postIndexHandler,
    showAllPosts: showAllPostsHandler
  };

  var context1 = {}, context2 = {};
  router.handleURL("/posts");
  router.trigger("expand", context1, context2);
});

test("paramsForHandler returns params", function() {
  var post = { id: 12 };

  var showPostHandler = {
    serialize: function(object) {
      return { id: object.id };
    },

    deserialize: function(params) {
      equal(params.id, 12, "The parameters are correct");
      return post;
    }
  };

  handlers = { showPost: showPostHandler };

  deepEqual(router.paramsForHandler('showPost', post), { id: 12 }, "The correct parameters were retrieved");
});

test("paramsForHandler uses the current context if you are already in a handler with a context that is not changing", function() {
  var admin = { id: 47 },
      adminPost = { id: 74 };

  var adminHandler = {
    serialize: function(object) {
      equal(object.id, 47, "The object passed to serialize is correct");
      return { id: 47 };
    },

    deserialize: function(params) {
      equal(params.id, 47, "The object passed to serialize is correct");
      return admin;
    }
  };

  var adminPostHandler = {
    serialize: function(object) {
      return { post_id: object.id };
    },

    deserialize: function(params) {
      equal(params.id, 74, "The object passed to serialize is correct");
      return adminPost;
    }
  };

  handlers = {
    admin: adminHandler,
    adminPost: adminPostHandler
  };

  var url;

  router.updateURL = function(passedURL) {
    url = passedURL;
  };

  router.transitionTo('adminPost', admin, adminPost);
  equal(url, '/posts/admin/47/posts/74', 'precond - the URL is correct');

  var params = router.paramsForHandler('adminPost', { id: 75 });
  deepEqual(params, { id: 47, post_id: 75 });

  var url = router.generate('adminPost', { id: 75 });
  deepEqual(url, '/posts/admin/47/posts/75');
});

test("when leaving a handler, the context is nulled out", function() {
  var admin = { id: 47 },
      adminPost = { id: 74 };

  var adminHandler = {
    serialize: function(object) {
      equal(object.id, 47, "The object passed to serialize is correct");
      return { id: 47 };
    },

    deserialize: function(params) {
      equal(params.id, 47, "The object passed to serialize is correct");
      return admin;
    }
  };

  var adminPostHandler = {
    serialize: function(object) {
      return { post_id: object.id };
    },

    deserialize: function(params) {
      equal(params.id, 74, "The object passed to serialize is correct");
      return adminPost;
    }
  };

  var showPostHandler = {

  };

  handlers = {
    admin: adminHandler,
    adminPost: adminPostHandler,
    showPost: showPostHandler
  };

  var url;

  router.updateURL = function(passedURL) {
    url = passedURL;
  };

  router.transitionTo('adminPost', admin, adminPost);
  equal(url, '/posts/admin/47/posts/74', 'precond - the URL is correct');
  deepEqual(router.currentHandlerInfos, [
    { context: { id: 47 }, handler: adminHandler, isDynamic: true, name: 'admin' },
    { context: { id: 74 }, handler: adminPostHandler, isDynamic: true, name: 'adminPost' }
  ]);

  router.transitionTo('showPost');
  ok(!adminHandler.hasOwnProperty('context'), "The inactive handler's context was nulled out");
  ok(!adminPostHandler.hasOwnProperty('context'), "The inactive handler's context was nulled out");
  deepEqual(router.currentHandlerInfos, [
    { context: undefined, handler: showPostHandler, isDynamic: true, name: 'showPost' }
  ]);
});

test("transitionTo uses the current context if you are already in a handler with a context that is not changing", function() {
  var admin = { id: 47 },
      adminPost = { id: 74 };

  var adminHandler = {
    serialize: function(object) {
      equal(object.id, 47, "The object passed to serialize is correct");
      return { id: 47 };
    },

    deserialize: function(params) {
      equal(params.id, 47, "The object passed to serialize is correct");
      return admin;
    }
  };

  var adminPostHandler = {
    serialize: function(object) {
      return { post_id: object.id };
    },

    deserialize: function(params) {
      equal(params.id, 74, "The object passed to serialize is correct");
      return adminPost;
    }
  };

  handlers = {
    admin: adminHandler,
    adminPost: adminPostHandler
  };

  var url;

  router.updateURL = function(passedURL) {
    url = passedURL;
  };

  router.transitionTo('adminPost', admin, adminPost);
  equal(url, '/posts/admin/47/posts/74', 'precond - the URL is correct');

  router.transitionTo('adminPost', { id: 75 });
  equal(url, '/posts/admin/47/posts/75', "the current context was used");
});

test("tests whether arguments to transitionTo are considered active", function() {
  var admin = { id: 47 },
      adminPost = { id: 74 };
      posts = {
        1: { id: 1 },
        2: { id: 2 },
        3: { id: 3 }
      };

  var adminHandler = {
    serialize: function(object) {
      return { id: 47 };
    },

    deserialize: function(params) {
      return admin;
    }
  };

  var adminPostHandler = {
    serialize: function(object) {
      return { post_id: object.id };
    },

    deserialize: function(params) {
      return adminPost;
    }
  };

  showPostHandler = {
    serialize: function(object) {
      return { post_id: object.id };
    },

    deserialize: function(params) {
      return posts[params.id];
    }
  }

  handlers = {
    admin: adminHandler,
    adminPost: adminPostHandler,
    showPost: showPostHandler
  };

  var url;

  router.updateURL = function(passedURL) {
    url = passedURL;
  };

  router.handleURL("/posts/1");
  ok(router.isActive('showPost'), "The showPost handler is active");
  ok(router.isActive('showPost', posts[1]), "The showPost handler is active with the appropriate context");
  ok(!router.isActive('showPost', posts[2]), "The showPost handler is inactive when the context is different");
  ok(!router.isActive('adminPost'), "The adminPost handler is inactive");

  router.transitionTo('adminPost', admin, adminPost);
  ok(router.isActive('adminPost'), "The adminPost handler is active");
  ok(router.isActive('adminPost', adminPost), "The adminPost handler is active with the current context");
  ok(router.isActive('adminPost', admin, adminPost), "The adminPost handler is active with the current and parent context");
  ok(router.isActive('admin'), "The admin handler is active");
  ok(router.isActive('admin', admin), "The admin handler is active with its context");
});

test("calling generate on a non-dynamic route does not blow away parent contexts", function() {
  router = new Router();

  router.map(function(match) {
    match("/projects").to('projects', function(match) {
      match("/").to('projectsIndex');
      match("/project").to('project', function(match) {
        match("/").to('projectIndex');
      });
    });
  });

  router.updateURL = function() { };

  router.getHandler = function(name) {
    return handlers[name];
  };

  var projects = {};

  var projectsHandler = {
    deserialize: function(){
      return projects;
    }
  };

  var projectsIndexHandler = {};
  var projectHandler = {};
  var projectIndexHandler = {};

  handlers = {
    projects:      projectsHandler,
    projectsIndex: projectsIndexHandler,
    project:       projectHandler,
    projectIndex:  projectIndexHandler
  };

  router.handleURL('/projects');

  equal(projectsHandler.context, projects, 'projects handler has correct context');

  router.generate('projectIndex');

  equal(projectsHandler.context, projects, 'projects handler retains correct context');
});

test("calling transitionTo on a dynamic parent route causes non-dynamic child context to be updated", function() {
  router = new Router();

  router.map(function(match) {
    match("/project/:project_id").to('project', function(match) {
      match("/").to('projectIndex');
    });
  });

  router.updateURL = function() { };

  router.getHandler = function(name) {
    return handlers[name];
  };

  var projectHandler = {
    deserialize: function(params) {
      return params;
    }
  };

  var projectIndexHandler = {
    deserialize: function() {
      return projectHandler.context;
    }
  };

  handlers = {
    project:       projectHandler,
    projectIndex:  projectIndexHandler
  };

  router.handleURL('/project/1');

  deepEqual(projectHandler.context, { project_id: '1' }, 'project handler retains correct context');
  deepEqual(projectIndexHandler.context, { project_id: '1' }, 'project index handler has correct context');

  router.generate('projectIndex', { project_id: '2' });

  deepEqual(projectHandler.context, { project_id: '1' }, 'project handler retains correct context');
  deepEqual(projectIndexHandler.context, { project_id: '1' }, 'project index handler retains correct context');

  router.transitionTo('projectIndex', { project_id: '2' });

  deepEqual(projectHandler.context, { project_id: '2' }, 'project handler has updated context');
  deepEqual(projectIndexHandler.context, { project_id: '2' }, 'project index handler has updated context');
});
