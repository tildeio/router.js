QUnit.config.testTimeout = 5000;

var router, url, handlers, expectedUrl;

module("The router", {
  setup: function() {
    handlers = {};
    expectedUrl = null;

    map(function(match) {
      match("/index").to("index");
      match("/about").to("about");
      match("/faq").to("faq");
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
  }
});

function map(fn) {
  router = new Router();
  router.map(fn);

  router.getHandler = function(name) {
    return handlers[name] || (handlers[name] = {});
  };

  router.updateURL = function(newUrl) {

    if (expectedUrl) {
      equal(newUrl, expectedUrl, "The url is " + newUrl+ " as expected");
    }

    url = newUrl;
  };
}

function followRedirect(reason) {
  ok(reason.name === "TransitionAborted" && router.activeTransition, "Transition was redirected");
  return router.activeTransition;
}

function shouldNotHappen(error) {
  console.error(error.stack);
  ok(false, "this .then handler should not be called");
}

test("Mapping adds named routes to the end", function() {
  url = router.recognizer.generate("showPost", { id: 1 });
  equal(url, "/posts/1");

  url = router.recognizer.generate("showAllPosts");
  equal(url, "/posts");
});

asyncTest("Handling an invalid URL returns a rejecting promise", function() {

  router.handleURL("/unknown").then(shouldNotHappen, function(e) {
    ok(e instanceof Router.UnrecognizedURLError, "rejects with UnrecognizedURLError");
    ok(e.name, "UnrecognizedURLError", "error.name is UnrecognizedURLError");
    start();
  }, shouldNotHappen);
});

function routePath(infos) {
  var path = [];

  for (var i=0, l=infos.length; i<l; i++) {
    path.push(infos[i].name);
  }

  return path.join(".");
}

asyncTest("Handling a URL triggers model on the handler and passes the result into the setup method", function() {
  expect(4);

  var post = { post: true };
  var posts = { index: true };

  handlers = {
    showPost: {
      model: function(params) {
        deepEqual(params, { id: "1" });
        return post;
      },

      setup: function(object) {
        strictEqual(object, post);
        equal(handlers.showPost.context, post);
      }
    }
  };

  router.didTransition = function(infos) {
    equal(routePath(infos), "showPost");
  };

  router.handleURL("/posts/1").then(start, shouldNotHappen);
});

asyncTest("handleURL accepts slash-less URLs", function() {

  handlers = {
    showAllPosts: {
      setup: function() {
        ok(true, "showAllPosts' setup called");
      }
    }
  };

  router.handleURL("posts/all").then(start);
});

asyncTest("when transitioning with the same context, setup should only be called once", function() {
  var parentSetupCount = 0,
      childSetupCount = 0;

  var context = { id: 1 };

  map(function(match) {
    match("/").to('index');
    match("/posts/:id").to('post', function(match) {
      match("/details").to('postDetails');
    });
  });

  handlers = {
    post: {
      setup: function() {
        parentSetupCount++;
      },

      model: function(params) {
        return params;
      }
    },

    postDetails: {
      setup: function() {
        childSetupCount++;
      }
    }
  };

  router.handleURL('/').then(function() {
    equal(parentSetupCount, 0, 'precond - parent not setup');
    equal(childSetupCount, 0, 'precond - parent not setup');

    return router.transitionTo('postDetails', context);
  }, shouldNotHappen).then(function() {
    equal(parentSetupCount, 1, 'after one transition parent is setup once');
    equal(childSetupCount, 1, 'after one transition child is setup once');

    return router.transitionTo('postDetails', context);
  }, shouldNotHappen).then(function() {
    equal(parentSetupCount, 1, 'after two transitions, parent is still setup once');
    equal(childSetupCount, 1, 'after two transitions, child is still setup once');
    start();
  }, shouldNotHappen);
});

asyncTest("when transitioning to a new parent and child state, the parent's context should be available to the child's model", function() {
  var contexts = [];

  map(function(match) {
    match("/").to('index');
    match("/posts/:id").to('post', function(match) {
      match("/details").to('postDetails');
    });
  });

  handlers = {
    post: {
      model: function(params, transition) {
        return contexts.post;
      }
    },

    postDetails: {
      name: 'postDetails',
      afterModel: function(model, transition) {
        contexts.push(transition.resolvedModels.post);
      }
    }
  };

  router.handleURL('/').then(function() {

    // This is a crucial part of the test
    // In some cases, calling `generate` was preventing `model` from being called
    router.generate('postDetails', { id: 1 });

    return router.transitionTo('postDetails', { id: 1 });
  }, shouldNotHappen).then(function() {
    deepEqual(contexts, [{ id: 1 }], 'parent context is available');
    start();
  }, shouldNotHappen);
});


asyncTest("A delegate provided to router.js is passed along to route-recognizer", function() {
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
  };

  router.handleURL("/posts").then(function() {
    deepEqual(handlers, [ "application", "posts", "posts.index", "application", "posts", "posts.index" ]);
    start();
  });
});

asyncTest("handleURL: Handling a nested URL triggers each handler", function() {
  expect(28);

  var posts = [];
  var allPosts = { all: true };
  var popularPosts = { popular: true };
  var amazingPosts = { id: "amazing" };
  var sadPosts = { id: "sad" };

  var counter = 0;

  var postIndexHandler = {
    model: function(params) {
      // this will always get called, since it's at the root
      // of all of the routes tested here
      deepEqual(params, {}, "params should be empty in postIndexHandler#model");
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
    model: function(params) {
      if (counter > 0 && counter < 4) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be set up in showAllPostsHandler#model");
      }

      if (counter < 4) {
        deepEqual(params, {}, "params should be empty in showAllPostsHandler#model");
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
    model: function(params) {
      if (counter < 3) {
        ok(false, "Should not get here");
      } else if (counter === 3) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be set up in showPopularPostsHandler#model");
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
    model: function(params) {
      if (counter < 4) {
        ok(false, "Should not get here");
      } else if (counter === 4) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be set up in showFilteredPostsHandler#model");
        deepEqual(params, { filter_id: 'amazing' }, "params should be { filter_id: 'amazing' } in showFilteredPostsHandler#model");
        return amazingPosts;
      } else if (counter === 5) {
        equal(postIndexHandler.context, posts, "postIndexHandler context should be posts in showFilteredPostsHandler#model");
        deepEqual(params, { filter_id: 'sad' }, "params should be { filter_id: 'sad' } in showFilteredPostsHandler#model");
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

  handlers = {
    postIndex: postIndexHandler,
    showAllPosts: showAllPostsHandler,
    showPopularPosts: showPopularPostsHandler,
    showFilteredPosts: showFilteredPostsHandler
  };

  router.transitionTo("/posts").then(function() {
    ok(true, "1: Finished, trying /posts/all");
    counter++;
    return router.transitionTo("/posts/all");
  }, shouldNotHappen).then(function() {
    ok(true, "2: Finished, trying /posts");
    counter++;
    return router.transitionTo("/posts");
  }, shouldNotHappen).then(function() {
    ok(true, "3: Finished, trying /posts/popular");
    counter++;
    return router.transitionTo("/posts/popular");
  }, shouldNotHappen).then(function() {
    ok(true, "4: Finished, trying /posts/filter/amazing");
    counter++;
    return router.transitionTo("/posts/filter/amazing");
  }, shouldNotHappen).then(function() {
    ok(true, "5: Finished, trying /posts/filter/sad");
    counter++;
    return router.transitionTo("/posts/filter/sad");
  }, shouldNotHappen).then(function() {
    ok(true, "6: Finished!");
    start();
  }, shouldNotHappen);
});

asyncTest("it can handle direct transitions to named routes", function() {
  var posts = [];
  var allPosts = { all: true };
  var popularPosts = { popular: true };
  var amazingPosts = { filter: "amazing" };
  var sadPosts = { filter: "sad" };

  var postIndexHandler = {
    model: function(params) {
      return allPosts;
    },

    serialize: function(object, params) {
      return {};
    },

    setup: function(object) {

    }
  };

  var showAllPostsHandler = {
    model: function(params) {
      //ok(!params, 'params is falsy for non dynamic routes');
      return allPosts;
    },

    serialize: function(object, params) {
      return {};
    },

    setup: function(object) {
      strictEqual(object, allPosts, 'showAllPosts should get correct setup');
    }
  };

  var showPopularPostsHandler = {
    model: function(params) {
      return popularPosts;
    },

    serialize: function(object) {
      return {};
    },

    setup: function(object) {
      strictEqual(object, popularPosts, "showPopularPosts#setup should be called with the deserialized value");
    }
  };

  var showFilteredPostsHandler = {
    model: function(params) {
      if (!params) { return; }
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
  };

  handlers = {
    postIndex: postIndexHandler,
    showAllPosts: showAllPostsHandler,
    showPopularPosts: showPopularPostsHandler,
    showFilteredPosts: showFilteredPostsHandler
  };

  router.updateURL = function(url) {
    var expected = {
      0: "/posts",
      1: "/posts/popular",
      2: "/posts/filter/amazing",
      3: "/posts/filter/sad",
      4: "/posts"
    };

    equal(url, expected[counter], 'updateURL should be called with correct url');
  };

  var counter = 0;

  router.handleURL("/posts").then(function() {
    return router.transitionTo("showAllPosts");
  }, shouldNotHappen).then(function() {
    counter++;
    return router.transitionTo("showPopularPosts");
  }, shouldNotHappen).then(function() {
    counter++;
    return router.transitionTo("showFilteredPosts", amazingPosts);
  }, shouldNotHappen).then(function() {
    counter++;
    return router.transitionTo("showFilteredPosts", sadPosts);
  }, shouldNotHappen).then(function() {
    counter++;
    return router.transitionTo("showAllPosts");
  }, shouldNotHappen).then(start);
});

asyncTest("replaceWith calls replaceURL", function() {
  var updateCount = 0,
      replaceCount = 0;

  router.updateURL = function() {
    updateCount++;
  };

  router.replaceURL = function() {
    replaceCount++;
  };

  router.handleURL('/posts').then(function(handlerInfos) {
    return router.replaceWith('about');
  }).then(function() {
    equal(updateCount, 0, "should not call updateURL");
    equal(replaceCount, 1, "should call replaceURL once");
    start();
  });
});


asyncTest("Moving to a new top-level route triggers exit callbacks", function() {
  expect(5);

  var allPosts = { posts: "all" };
  var postsStore = { 1: { id: 1 }, 2: { id: 2 } };
  var currentId, currentPath;

  handlers = {
    showAllPosts: {
      model: function(params) {
        return allPosts;
      },

      setup: function(posts) {
        equal(posts, allPosts, "The correct context was passed into showAllPostsHandler#setup");
        currentPath = "postIndex.showAllPosts";
      },

      exit: function() {
        ok(true, "Should get here");
      }
    },

    showPost: {
      model: function(params, resolvedModels) {
        return postsStore[params.id];
      },

      serialize: function(post) {
        return { id: post.id };
      },

      setup: function(post) {
        currentPath = "showPost";
        equal(post.id, currentId, "The post id is " + currentId);
      }
    }
  };

  router.handleURL("/posts").then(function() {
    expectedUrl = "/posts/1";
    currentId = 1;
    return router.transitionTo('showPost', postsStore[1]);
  }, shouldNotHappen).then(function() {
    equal(routePath(router.currentHandlerInfos), currentPath);
    start();
  }, shouldNotHappen);
});

asyncTest("Moving to the same route with a different parent dynamic segment re-runs model", function() {
  var admins = { 1: { id: 1 }, 2: { id: 2 } },
      adminPosts = { 1: { id: 1 }, 2: { id: 2 } },
      adminPostModel = 0;

  handlers = {
    admin: {
      model: function(params) {
        return this.currentModel = admins[params.id];
      }
    },

    adminPosts: {
      model: function() {
        adminPostModel++;
        return adminPosts[handlers.admin.currentModel.id];
      }
    }
  };

  router.handleURL("/posts/admin/1/posts").then(function() {
    equal(handlers.admin.context, admins[1]);
    equal(handlers.adminPosts.context, adminPosts[1]);
    return router.handleURL("/posts/admin/2/posts");
  }).then(function() {
    equal(handlers.admin.context, admins[2]);
    equal(handlers.adminPosts.context, adminPosts[2]);
    start();
  });
});

asyncTest("Moving to a sibling route only triggers exit callbacks on the current route (when transitioned internally)", function() {
  expect(8);

  var allPosts = { posts: "all" };
  var postsStore = { 1: { id: 1 }, 2: { id: 2 } };
  var currentId;

  var showAllPostsHandler = {
    model: function(params) {
      return allPosts;
    },

    setup: function(posts) {
      equal(posts, allPosts, "The correct context was passed into showAllPostsHandler#setup");

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

    model: function(params) {
      var id = params.filter_id;
      if (!filters[id]) {
        filters[id] = { id: id };
      }

      return filters[id];
    },

    serialize: function(filter) {
      equal(filter.id, "favorite", "The filter should be 'favorite'");
      return { filter_id: filter.id };
    },

    setup: function(filter) {
      equal(filter.id, "favorite", "showFilteredPostsHandler#setup was called with the favorite filter");
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

  router.handleURL("/posts").then(function() {
    expectedUrl = "/posts/filter/favorite";
    return router.transitionTo('showFilteredPosts', { id: 'favorite' });
  }).then(start);
});

asyncTest("Moving to a sibling route only triggers exit callbacks on the current route (when transitioned via a URL change)", function() {
  expect(7);

  var allPosts = { posts: "all" };
  var postsStore = { 1: { id: 1 }, 2: { id: 2 } };
  var currentId;

  var showAllPostsHandler = {
    model: function(params) {
      return allPosts;
    },

    setup: function(posts) {
      equal(posts, allPosts, "The correct context was passed into showAllPostsHandler#setup");

      setTimeout(function() {
        expectedUrl = "/posts/filter/favorite";
        router.handleURL(expectedUrl);
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

    model: function(params) {
      equal(params.filter_id, "favorite", "The filter should be 'favorite'");

      var id = params.filter_id;
      if (!filters[id]) {
        filters[id] = { id: id };
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

  router.handleURL("/posts");
});

asyncTest("events can be targeted at the current handler", function() {

  handlers = {
    showPost: {
      enter: function() {
        ok(true, "The show post handler was entered");
      },

      events: {
        expand: function() {
          equal(this, handlers.showPost, "The handler is the `this` for the event");
          start();
        }
      }
    }
  };

  router.handleURL("/posts/1").then(function() {
    router.trigger("expand");
  });
});

test("Unhandled events raise an exception", function() {
  router.handleURL("/posts/1");

  throws(function() {
    router.trigger("doesnotexist");
  }, /doesnotexist/);
});

asyncTest("events can be targeted at a parent handler", function() {
  expect(3);

  handlers = {
    postIndex: {
      enter: function() {
        ok(true, "The post index handler was entered");
      },

      events: {
        expand: function() {
          equal(this, handlers.postIndex, "The handler is the `this` in events");
          start();
        }
      }
    },
    showAllPosts: {
      enter: function() {
        ok(true, "The show all posts handler was entered");
      }
    }
  };

  router.handleURL("/posts").then(function(result) {
    router.trigger("expand");
  });
});

asyncTest("events can bubble up to a parent handler via `return true`", function() {
  expect(4);

  handlers = {
    postIndex: {
      enter: function() {
        ok(true, "The post index handler was entered");
      },

      events: {
        expand: function() {
          equal(this, handlers.postIndex, "The handler is the `this` in events");
          start();
        }
      }
    },
    showAllPosts: {
      enter: function() {
        ok(true, "The show all posts handler was entered");
      },
      events: {
        expand: function() {
          equal(this, handlers.showAllPosts, "The handler is the `this` in events");
          return true;
        }
      }
    }
  };

  router.handleURL("/posts").then(function(result) {
    router.trigger("expand");
  });
});

asyncTest("handled-then-bubbled events don't throw an exception if uncaught by parent route", function() {
  expect(3);

  handlers = {
    postIndex: {
      enter: function() {
        ok(true, "The post index handler was entered");
      }
    },

    showAllPosts: {
      enter: function() {
        ok(true, "The show all posts handler was entered");
      },
      events: {
        expand: function() {
          equal(this, handlers.showAllPosts, "The handler is the `this` in events");
          start();
          return true;
        }
      }
    }
  };

  router.handleURL("/posts").then(function(result) {
    router.trigger("expand");
  });
});

asyncTest("events only fire on the closest handler", function() {
  expect(5);

  handlers = {
    postIndex: {
      enter: function() {
        ok(true, "The post index handler was entered");
      },

      events: {
        expand: function() {
          ok(false, "Should not get to the parent handler");
        }
      }
    },

    showAllPosts: {
      enter: function() {
        ok(true, "The show all posts handler was entered");
      },

      events: {
        expand: function(passedContext1, passedContext2) {
          equal(context1, passedContext1, "A context is passed along");
          equal(context2, passedContext2, "A second context is passed along");
          equal(this, handlers.showAllPosts, "The handler is passed into events as `this`");
          start();
        }
      }
    }
  };

  var context1 = {}, context2 = {};
  router.handleURL("/posts").then(function(result) {
    router.trigger("expand", context1, context2);
  });
});

test("paramsForHandler returns params", function() {
  var post = { id: 12 };

  handlers = {
    showPost: {
      serialize: function(object) {
        return { id: object.id };
      },

      model: function(params) {
        equal(params.id, 12, "The parameters are correct");
        return post;
      }
    }
  };

  deepEqual(router.paramsForHandler('showPost', post), { id: 12 }, "The correct parameters were retrieved with a context object");
  deepEqual(router.paramsForHandler('showPost', 12),   { id: 12 }, "The correct parameters were retrieved with a numeric id");
  deepEqual(router.paramsForHandler('showPost', "12"), { id: "12" }, "The correct parameters were retrieved with a string id");
});

asyncTest("when leaving a handler, the context is nulled out", function() {
  var admin = { id: 47 },
      adminPost = { id: 74 };

  handlers = {
    admin: {
      serialize: function(object) {
        equal(object.id, 47, "The object passed to serialize is correct");
        return { id: 47 };
      },

      model: function(params) {
        equal(params.id, 47, "The object passed to serialize is correct");
        return admin;
      }
    },

    adminPost: {
      serialize: function(object) {
        return { post_id: object.id };
      },

      model: function(params) {
        equal(params.id, 74, "The object passed to serialize is correct");
        return adminPost;
      }
    }
  };

  expectedUrl = '/posts/admin/47/posts/74';
  router.transitionTo('adminPost', admin, adminPost).then(function(result) {

    deepEqual(router.currentHandlerInfos, [
      { context: { id: 47 }, handler: handlers.admin, isDynamic: true, name: 'admin' },
      { context: { id: 74 }, handler: handlers.adminPost, isDynamic: true, name: 'adminPost' }
    ]);

    expectedUrl = null;
    return router.transitionTo('showPost');
  }, shouldNotHappen).then(function() {
    ok(!handlers.admin.hasOwnProperty('context'), "The inactive handler's context was nulled out");
    ok(!handlers.adminPost.hasOwnProperty('context'), "The inactive handler's context was nulled out");
    deepEqual(router.currentHandlerInfos, [
      { context: undefined, handler: handlers.showPost, isDynamic: true, name: 'showPost' }
    ]);
    start();
  }, shouldNotHappen);
});

asyncTest("transitionTo uses the current context if you are already in a handler with a context that is not changing", function() {
  var admin = { id: 47 },
      adminPost = { id: 74 };

  handlers = {
    admin: {
      serialize: function(object) {
        equal(object.id, 47, "The object passed to serialize is correct");
        return { id: 47 };
      },

      model: function(params) {
        equal(params.id, 47, "The object passed to serialize is correct");
        return admin;
      }
    },

    adminPost: {
      serialize: function(object) {
        return { post_id: object.id };
      },

      model: function(params) {
        equal(params.id, 74, "The object passed to serialize is correct");
        return adminPost;
      }
    }
  };

  expectedUrl = '/posts/admin/47/posts/74';
  router.transitionTo('adminPost', admin, adminPost).then(function(result) {
    expectedUrl =  '/posts/admin/47/posts/75';
    return router.transitionTo('adminPost', { id: 75 });
  }).then(function(result) {
    start();
  });
});

asyncTest("tests whether arguments to transitionTo are considered active", function() {
  var admin = { id: 47 },
      adminPost = { id: 74 },
      posts = {
        1: { id: 1 },
        2: { id: 2 },
        3: { id: 3 }
      };

  var adminHandler = {
    serialize: function(object) {
      return { id: 47 };
    },

    model: function(params) {
      return admin;
    }
  };

  var adminPostHandler = {
    serialize: function(object) {
      return { post_id: object.id };
    },

    model: function(params) {
      return adminPost;
    }
  };

  var showPostHandler = {
    serialize: function(object) {
      return { id: object.id };
    },

    model: function(params) {
      return posts[params.id];
    }
  };

  handlers = {
    admin: adminHandler,
    adminPost: adminPostHandler,
    showPost: showPostHandler
  };

  router.handleURL("/posts/1").then(function(result) {
    ok(router.isActive('showPost'), "The showPost handler is active");
    ok(router.isActive('showPost', posts[1]), "The showPost handler is active with the appropriate context");
    ok(!router.isActive('showPost', posts[2]), "The showPost handler is inactive when the context is different");
    ok(!router.isActive('adminPost'), "The adminPost handler is inactive");
    ok(!router.isActive('showPost', null), "The showPost handler is inactive with a null context");

    return router.transitionTo('adminPost', admin, adminPost);
  }).then(function(result) {
    ok(router.isActive('adminPost'), "The adminPost handler is active");
    ok(router.isActive('adminPost', adminPost), "The adminPost handler is active with the current context");
    ok(router.isActive('adminPost', admin, adminPost), "The adminPost handler is active with the current and parent context");
    ok(router.isActive('admin'), "The admin handler is active");
    ok(router.isActive('admin', admin), "The admin handler is active with its context");
    start();
  });
});

asyncTest("calling generate on a non-dynamic route does not blow away parent contexts", function() {
  map(function(match) {
    match("/projects").to('projects', function(match) {
      match("/").to('projectsIndex');
      match("/project").to('project', function(match) {
        match("/").to('projectIndex');
      });
    });
  });

  var projects = {};

  handlers = {
    projects: {
      model: function(){
        return projects;
      }
    }
  };

  router.handleURL('/projects').then(function(result) {
    equal(handlers.projects.context, projects, 'projects handler has correct context');
    router.generate('projectIndex');
    equal(handlers.projects.context, projects, 'projects handler retains correct context');
    start();
  });
});

asyncTest("calling transitionTo on a dynamic parent route causes non-dynamic child context to be updated", function() {
  map(function(match) {
    match("/project/:project_id").to('project', function(match) {
      match("/").to('projectIndex');
    });
  });

  var projectHandler = {
    model: function(params) {
      return params;
    }
  };

  var projectIndexHandler = {
    model: function(params, transition) {
      return transition.resolvedModels.project;
    }
  };

  handlers = {
    project:       projectHandler,
    projectIndex:  projectIndexHandler
  };

  router.handleURL('/project/1').then(function(result) {
    deepEqual(projectHandler.context, { project_id: '1' }, 'project handler retains correct context');
    deepEqual(projectIndexHandler.context, { project_id: '1' }, 'project index handler has correct context');

    router.generate('projectIndex', { project_id: '2' });

    deepEqual(projectHandler.context, { project_id: '1' }, 'project handler retains correct context');
    deepEqual(projectIndexHandler.context, { project_id: '1' }, 'project index handler retains correct context');

    return router.transitionTo('projectIndex', { project_id: '2' });
  }).then(function(result) {
    deepEqual(projectHandler.context, { project_id: '2' }, 'project handler has updated context');
    deepEqual(projectIndexHandler.context, { project_id: '2' }, 'project index handler has updated context');
    start();
  });
});

asyncTest("reset exits and clears the current and target route handlers", function() {
  var postIndexExited = false;
  var showAllPostsExited = false;

  var postIndexHandler = {
    exit: function() {
      postIndexExited = true;
    }
  };
  var showAllPostsHandler = {
    exit: function() {
      showAllPostsExited = true;
    }
  };
  handlers = {
    postIndex: postIndexHandler,
    showAllPosts: showAllPostsHandler
  };


  router.handleURL("/posts/all").then(function(result) {
    router.reset();
    router.reset(); // two resets back to back should work

    ok(postIndexExited, "Post index handler did not exit");
    ok(showAllPostsExited, "Show all posts handler did not exit");
    equal(router.currentHandlerInfos, null, "currentHandlerInfos should be null");
    equal(router.targetHandlerInfos, null, "targetHandlerInfos should be null");
    start();
  });
});

asyncTest("any of the model hooks can redirect with or without promise", function() {
  expect(21);
  var setupShouldBeEntered = false;
  var returnPromise = false;
  var redirectTo;
  var shouldFinish;

  function redirectToAbout() {
    if (returnPromise) {
      return RSVP.reject().then(null, function() {
        router.transitionTo(redirectTo);
      });
    } else {
      router.transitionTo(redirectTo);
    }
  }

  handlers = {
    index: {
      beforeModel: redirectToAbout,
      model: redirectToAbout,
      afterModel: function() {
        redirectToAbout();
      },

      setup: function() {
        ok(setupShouldBeEntered, "setup should be entered at this time");
      }
    },

    about: {
      setup: function() {
        ok(true, "about handler's setup function was called");
      }
    },

    borf: {
      setup: function() {
        ok(true, "borf setup entered");
      }
    }
  };


  function testStartup() {
    map(function(match) {
      match("/").to('index');
      match("/about").to('about');
      match("/foo").to('foo');
      match("/borf").to('borf');
    });

    redirectTo = 'about';

    // Perform a redirect on startup.
    return router.handleURL('/').then(null, function(e) {

      ok(e instanceof Router.TransitionAborted, 'transition was redirected');
      redirectTo = 'borf';

      // Run transitionTo
      return router.transitionTo('index').then(null, function(e) {
        ok(e instanceof Router.TransitionAborted, 'second transition was redirected');


        // This is the problem. We're catching the failure handler here, but not the
        // promise that gets redirected to. So how tracks that?
      });
    });
  }

  // Note: the .resolve() paddings are here because there's no way
  // to .then the redirected-to transitions.
  testStartup().then(function(result) {
    returnPromise = true;
    return RSVP.resolve().then(testStartup);
  }, shouldNotHappen).then(function(result) {
    delete handlers.index.beforeModel;
    returnPromise = false;
    return RSVP.resolve().then(testStartup);
  }, shouldNotHappen).then(function(result) {
    returnPromise = true;
    return RSVP.resolve().then(testStartup);
  }, shouldNotHappen).then(function(result) {
    delete handlers.index.model;
    returnPromise = false;
    return RSVP.resolve().then(testStartup);
  }, shouldNotHappen).then(function(result) {
    returnPromise = true;
    return RSVP.resolve().then(testStartup);
  }, shouldNotHappen).then(function(result) {
    delete handlers.index.afterModel;
    setupShouldBeEntered = true;
    shouldFinish = true;
    return RSVP.resolve().then(testStartup);
  }, shouldNotHappen).then(start);
});



function testNamedTransitionsPauseAtPromise(methodName) {
  handlers = {
    index: {},
    showPost: {
      setup: function(context) {
        deepEqual(context, { id: 1 }, "setup receives a resolved context");
      }
    }
  };

  router.handleURL('/index').then(function() {
    return router.transitionTo('showPost', new RSVP.Promise(function(resolve, reject) {
      resolve({ id: 1 });
    }));
  }).then(start);
}

asyncTest("transitionTo with a promise pauses the transition until resolve, passes resolved context to setup", function() {
  testNamedTransitionsPauseAtPromise('transitionTo');
});

asyncTest("transitionTo with a promise pauses the transition until resolve, passes resolved context to setup", function() {
  testNamedTransitionsPauseAtPromise('transitionTo');
});

asyncTest("error handler gets called for errors in validation hooks", function() {
  expect(25);
  var setupShouldBeEntered = false;
  var returnPromise = false;
  var expectedReason = { reason: 'No funciona, mon frere.' };

  function throwAnError() {
    if (returnPromise) {
      return RSVP.reject(expectedReason);
    } else {
      throw expectedReason;
    }
  }


  handlers = {
    index: {
      beforeModel: throwAnError,
      model: throwAnError,
      afterModel: throwAnError,

      events: {
        error: function(reason) {
          equal(reason, expectedReason, "the value passed to the error handler is what was 'thrown' from the hook");
        },
      },

      setup: function() {
        ok(setupShouldBeEntered, "setup should be entered at this time");
      }
    },

    about: {
      setup: function() {
        ok(true, "about handler's setup function was called");
      }
    }
  };


  function testStartup() {
    map(function(match) {
      match("/").to('index');
      match("/about").to('about');
    });

    // Perform a redirect on startup.
    return router.handleURL('/').then(null, function(reason) {
      equal(reason, expectedReason, "handleURL error reason is what was originally thrown");

      return router.transitionTo('index').then(null, function(newReason) {
        equal(newReason, expectedReason, "transitionTo error reason is what was originally thrown");
      });
    });
  }

  testStartup().then(function(result) {
    returnPromise = true;
    return testStartup();
  }).then(function(result) {
    delete handlers.index.beforeModel;
    returnPromise = false;
    return testStartup();
  }).then(function(result) {
    returnPromise = true;
    return testStartup();
  }).then(function(result) {
    delete handlers.index.model;
    returnPromise = false;
    return testStartup();
  }).then(function(result) {
    returnPromise = true;
    return testStartup();
  }).then(function(result) {
    delete handlers.index.afterModel;
    setupShouldBeEntered = true;
    return testStartup();
  }).then(function(result) {
    setTimeout(start, 200);
  }, shouldNotHappen);
});

asyncTest("Errors shouldn't be handled after proceeding to next child route", function() {

  expect(2);

  map(function(match) {
    match("/parent").to('parent', function(match) {
      match("/articles").to('articles');
      match("/login").to('login');
    });
  });

  handlers = {
    articles: {
      beforeModel: function() {
        ok(true, "articles beforeModel was entered");
        return RSVP.reject("blorg");
      },
      events: {
        error: function() {
          ok(true, "error handled in articles");
          router.transitionTo('login');
        }
      }
    },

    login: {
      setup: function() {
        start();
      }
    },

    parent: {
      events: {
        error: function() {
          ok(false, "handled error shouldn't bubble up to parent route");
        }
      }
    }
  };

  router.handleURL('/parent/articles');
});


asyncTest("error handler gets called for errors in validation hooks, even if transition.abort was also called", function() {
  expect(25);
  var expectedReason = { reason: 'I am an error!' };
  var returnPromise = false;
  var setupShouldBeEntered = false;
  function aborTransitionAndThrowAnError() {
    var transition = arguments[arguments.length - 1];
    transition.abort();
    // abort, but also reject the promise for a different reason
    if (returnPromise) {
      return RSVP.reject(expectedReason);
    } else {
      throw expectedReason;
    }
  }


  handlers = {
    index: {
      beforeModel: aborTransitionAndThrowAnError,
      model: aborTransitionAndThrowAnError,
      afterModel: aborTransitionAndThrowAnError,

      events: {
        error: function(reason) {
          equal(reason, expectedReason, "the value passed to the error handler is what was 'thrown' from the hook");
        },
      },

      setup: function() {
        ok(setupShouldBeEntered, "setup should be entered at this time");
      }
    },

    about: {
      setup: function() {
        ok(true, "about handler's setup function was called");
      }
    }
  };

  function testStartup() {
    map(function(match) {
      match("/").to('index');
      match("/about").to('about');
    });

    // Perform a redirect on startup.
    return router.handleURL('/').then(null, function(reason) {
      equal(reason, expectedReason, "handleURL error reason is what was originally thrown");

      return router.transitionTo('index').then(null, function(newReason) {
        equal(newReason, expectedReason, "transitionTo error reason is what was originally thrown");
      });
    });
  }

  testStartup().then(function(result) {
    returnPromise = true;
    return testStartup();
  }).then(function(result) {
    delete handlers.index.beforeModel;
    returnPromise = false;
    return testStartup();
  }).then(function(result) {
    returnPromise = true;
    return testStartup();
  }).then(function(result) {
    delete handlers.index.model;
    returnPromise = false;
    return testStartup();
  }).then(function(result) {
    returnPromise = true;
    return testStartup();
  }).then(function(result) {
    delete handlers.index.afterModel;
    setupShouldBeEntered = true;
    return testStartup();
  }).then(function(result) {
    setTimeout(start, 200);
  }, shouldNotHappen);
});

asyncTest("can redirect from error handler", function() {

  expect(4);

  var errorCount = 0;

  handlers = {
    index: { },

    showPost: {
      model: function() {
        return RSVP.reject('borf!');
      },
      events: {
        error: function(e) {
          errorCount++;

          equal(e, 'borf!', "received error thrown from model");

          // Redirect to index.
          router.transitionTo('index').then(function() {

            if (errorCount === 1) {
              // transition back here to test transitionTo error handling.

              var p = new RSVP.Promise(function(resolve, reject) {
                reject('borf!');
              });

              return router.transitionTo('showPost', p).then(shouldNotHappen, function(e) {
                equal(e, 'borf!');
                start();
              });
            }

          }, shouldNotHappen);
        }
      },

      setup: function(context) {
        ok(false, 'should not get here');
      }
    }
  };

  router.handleURL('/posts/123').then(shouldNotHappen, function(reason) {
    equal(reason, 'borf!', 'expected reason received from first failed transition');
  });
});

asyncTest("errors in enter/setup hooks fire `error`", function() {
  expect(4);

  var count = 0;

  handlers = {
    index: {
      enter: function() {
        throw "OMG ENTER";
      },
      setup: function() {
        throw "OMG SETUP";
      },
      events: {
        error: function(e) {
          if (count === 0) {
            equal(e, "OMG ENTER", "enter's throw value passed to error hook");
          } else if(count === 1) {
            equal(e, "OMG SETUP", "setup's throw value passed to error hook");
          } else {
            ok(false, 'should not happen');
          }
        }
      }
    }
  };

  router.handleURL('/index').then(shouldNotHappen, function(reason) {
    equal(reason, "OMG ENTER", "enters's error was propagated");
    count++;
    delete handlers.index.enter;
    return router.handleURL('/index');
  }).then(shouldNotHappen, function(reason) {
    equal(reason, "OMG SETUP", "setup's error was propagated");
    delete handlers.index.setup;
  }).then(start, shouldNotHappen);
});

function assertAbort(e) {
  ok(e instanceof Router.TransitionAborted, "transition was aborted");
}

asyncTest("can redirect from setup/enter", function() {
  expect(6);

  var count = 0;

  handlers = {
    index: {
      enter: function() {
        ok(true, "enter called");
        router.transitionTo('about').then(secondAttempt);
      },
      setup: function() {
        ok(true, "setup called");
        router.transitionTo('/about').then(thirdAttempt);
      },
      events: {
        error: function(e) {
          ok(false, "redirects should not call error hook");
        }
      }
    },
    about: {
      setup: function() {
        ok(true, "setup was entered");
      }
    }
  };

  router.handleURL('/index').then(shouldNotHappen, assertAbort);

  function secondAttempt() {
    delete handlers.index.enter;
    router.transitionTo('index').then(shouldNotHappen, assertAbort);
  }

  function thirdAttempt() {
    delete handlers.index.setup;
    router.transitionTo('index').then(start, shouldNotHappen);
  }
});


asyncTest("redirecting to self from validation hooks should no-op (and not infinite loop)", function() {

  expect(2);

  var count = 0;

  handlers = {
    index: {
      afterModel: function() {
        if (count++ > 10) {
          ok(false, 'infinite loop occurring');
        } else {
          ok(count <= 2, 'running index no more than twice');
          var p = router.transitionTo('index');
        }
      },
      setup: function() {
        ok(true, 'setup was called');
      }
    }
  };

  router.handleURL('/index');

  // TODO: use start in .then() handler instead of setTimeout, but CLI
  // test runner doesn't seem to like this.
  setTimeout(start, 500);
});

asyncTest("redirecting to self from enter hooks should no-op (and not infinite loop)", function() {
  expect(1);

  var count = 0;

  handlers = {
    index: {
      setup: function() {
        if (count++ > 10) {
          ok(false, 'infinite loop occurring');
        } else {
          ok(true, 'setup was called');
          router.transitionTo('index');
        }
      }
    }
  };

  router.handleURL('/index');

  // TODO: use start in .then() handler instead of setTimeout, but CLI
  // test runner doesn't seem to like this.
  setTimeout(start, 500);
});

asyncTest("redirecting to child handler from validation hooks should no-op (and not infinite loop)", function() {
  expect(4);

  handlers = {

    postIndex: {
      beforeModel: function() {
        ok(true, 'postIndex beforeModel called');
        router.transitionTo('showAllPosts');
      }
    },

    showAllPosts: {
      beforeModel: function() {
        ok(true, 'showAllPosts beforeModel called');
      }
    },

    showPopularPosts: {
      beforeModel: function() {
        ok(true, 'showPopularPosts beforeModel called');
      }
    }
  };

  router.handleURL('/posts/popular').then(function() {
    ok(false, 'redirected handleURL should not succeed');
  }, function() {
    ok(true, 'redirected handleURL should fail');
    start();
  });
});

function startUpSetup() {
  handlers = {
    index: {
      setup: function() {
        ok(true, 'index setup called');
      }
    },
    about: {
      setup: function() {
        ok(true, 'about setup called');
      }
    },
    faq: {
      setup: function() {
        ok(true, 'faq setup called');
      }
    }
  };
}

asyncTest("transitionTo with named transition can be called at startup", function() {
  expect(2);

  startUpSetup();

  router.transitionTo('index').then(function() {
    ok(true, 'success handler called');
    start();
  }, function(e) {
    ok(false, 'failure handle should not be called');
  });
});

asyncTest("transitionTo with URL transition can be called at startup", function() {
  expect(2);

  startUpSetup();

  router.transitionTo('/index').then(function() {
    ok(true, 'success handler called');
    start();
  }, function(e) {
    ok(false, 'failure handle should not be called');
  });
});

asyncTest("transitions can aborted in the willTransition event", function() {

  expect(3);

  handlers = {
    index: {
      setup: function() {
        ok(true, 'index setup called');
      },
      events: {
        willTransition: function(transition) {
          ok(true, "index's transitionTo was called");
          transition.abort();
        }
      }
    },
    about: {
      setup: function() {
        ok(true, 'about setup called');
      }
    }
  };

  router.handleURL('/index').then(function() {
    router.transitionTo('about').then(shouldNotHappen, function(e) {
      equal(e.name, 'TransitionAborted', 'reject object is a TransitionAborted');
    }).then(start);
  });
});

asyncTest("transitions can redirected in the willTransition event", function() {

  expect(2);

  var destFlag = true;

  handlers = {
    index: {
      setup: function() {
        ok(true, 'index setup called');
      },
      events: {
        willTransition: function(transition) {
          // Router code must be careful here not to refire
          // `willTransition` when a transition is already
          // underway, else infinite loop.
          var dest = destFlag ? 'about' : 'faq';
          destFlag = !destFlag;
          router.transitionTo(dest).then(start);
        }
      }
    },
    about: {
      setup: function() {
        ok(true, 'about setup called');
      }
    },
    faq: {
      setup: function() {
        ok(false, 'faq setup should not be called');
      }
    }
  };

  router.handleURL('/index').then(function() {
    router.transitionTo('faq');
  });
});

asyncTest("transitions can be saved and later retried", function() {

  expect(8);

  var shouldPrevent = true,
      lastTransitionEvent,
      transitionToAbout,
      lastTransition;

  handlers = {
    index: {
      setup: function() {
        ok(true, 'index setup called');
      },
      events: {
        willTransition: function(transition) {
          ok(true, "index's willTransition was called");
          if (shouldPrevent) {
            transition.data.foo = "hello";
            transition.foo = "hello";
            transition.abort();
            lastTransition = transition;
          } else {
            ok(!transition.foo, "no foo property exists on new transition");
            equal(transition.data.foo, "hello", "values stored in data hash of old transition persist when retried");
          }
        }
      }
    },
    about: {
      setup: function() {
        ok(true, 'about setup called');
      }
    }
  };

  router.handleURL('/index').then(function() {
    router.transitionTo('about').then(shouldNotHappen, function(e) {
      ok(true, 'transition was blocked');
      shouldPrevent = false;
      transitionToAbout = lastTransition;
      return transitionToAbout.retry();
    }).then(function() {
      ok(true, 'transition succeeded via .retry()');
      start();
    }, shouldNotHappen);
  });
});



function setupAuthenticatedExample() {
  map(function(match) {
    match("/index").to("index");
    match("/login").to("login");

    match("/admin").to("admin", function(match) {
      match("/about").to("about");
      match("/posts/:post_id").to("adminPost");
    });
  });

  var isLoggedIn = false, lastRedirectedTransition;

  handlers = {
    index: { },
    login: {
      events: {
        logUserIn: function() {
          isLoggedIn = true;
          lastRedirectedTransition.retry();
        }
      }
    },
    admin: {
      beforeModel: function(transition) {
        lastRedirectedTransition = transition;
        ok(true, 'beforeModel redirect was called');
        if (!isLoggedIn) { router.transitionTo('login'); }
      }
    },
    about: {
      setup: function() {
        ok(isLoggedIn, 'about was entered only after user logged in');
        start();
      }
    },
    adminPost: {
      model: function(params) {
        deepEqual(params, { post_id: '5' }, "adminPost received params previous transition attempt");
        return "adminPost";
      },
      setup: function(model) {
        equal(model, "adminPost", "adminPost was entered with correct model");
        start();
      }
    }
  };
}


asyncTest("authenticated routes: starting on non-auth route", function() {
  expect(8);

  setupAuthenticatedExample();

  router.handleURL('/index').then(function() {
    return router.transitionTo('about');
  }).then(shouldNotHappen, function(result) {
    equal(result.name, "TransitionAborted", "transition was redirected");

    return router.transitionTo('about');
  }).then(shouldNotHappen, function(result) {
    equal(result.name, "TransitionAborted", "transition from login to restricted about was redirected back to login");

    return router.handleURL('/admin/about');
  }).then(shouldNotHappen, function(result) {
    equal(result.name, "TransitionAborted", "transition from login to restricted about was redirected back to login");

    // Log in. This will retry the last failed transition to 'about'.
    router.trigger('logUserIn');
  });
});

asyncTest("authenticated routes: starting on auth route", function() {
  expect(8);

  setupAuthenticatedExample();

  router.handleURL('/admin/about').then(null, function(result) {
    equal(result.name, "TransitionAborted", "transition was redirected");

    // Nav back to previously-redirected page.
    return router.handleURL('/admin/about');
  }).then(null, function(result) {
    equal(result.name, "TransitionAborted", "transition from login to restricted about was redirected back to login");

    // Try a URL navigation.
    return router.transitionTo('about');
  }).then(null, function(result) {
    equal(result.name, "TransitionAborted", "transition from login to restricted about was redirected back to login");

    // Log in. This will retry the last failed transition to 'about'.
    router.trigger('logUserIn');
  });
});

asyncTest("authenticated routes: starting on parameterized auth route", function() {
  expect(4);

  setupAuthenticatedExample();

  router.handleURL('/admin/posts/5').then(shouldNotHappen, function(result) {
    // Log in. This will retry the last failed transition to '/posts/5'.
    router.trigger('logUserIn');
  });
});

asyncTest("An instantly aborted transition fires no hooks", function() {

  var hooksShouldBeCalled = false;

  handlers = {
    index: {
      beforeModel: function() {
        ok(hooksShouldBeCalled, "index beforeModel hook should be called at this time");
      }
    },
    about: {
      beforeModel: function() {
        ok(hooksShouldBeCalled, "about beforeModel hook should be called at this time");
      },
      setup: function() {
        start();
      }
    }
  };

  router.transitionTo('index').abort().then(shouldNotHappen, function() {
    ok(true, "Failure handler called for index");
    return router.transitionTo('/index').abort();
  }).then(shouldNotHappen, function() {
    ok(true, "Failure handler called for /index");
    hooksShouldBeCalled = true;
    return router.transitionTo('index');
  }).then(function(result) {
    ok(true, "Success handler called for index");
    hooksShouldBeCalled = false;
    return router.transitionTo('about').abort();
  }, shouldNotHappen).then(shouldNotHappen, function() {
    ok(true, "failure handler called for about");
    return router.transitionTo('/about').abort();
  }, shouldNotHappen).then(shouldNotHappen, function() {
    ok(true, "failure handler called for /about");
    hooksShouldBeCalled = true;
    return router.transitionTo('/about');
  });
});

asyncTest("a successful transition resolves with the target handler", function() {
  // Note: this is extra convenient for Ember where you can all
  // .transitionTo right on the route.

  handlers = {
    index: { borfIndex: true },
    about: { borfAbout: true }
  };

  router.handleURL('/index').then(function(result) {
    ok(result.borfIndex, "resolved to index handler");
    return router.transitionTo('about');
  }, shouldNotHappen).then(function(result) {
    ok(result.borfAbout, "resolved to about handler");
    start();
  });
});

asyncTest("transitions have a .promise property", function() {
  router.handleURL('/index').promise.then(function(result) {
    var promise = router.transitionTo('about').abort().promise;
    ok(promise, "promise exists on aborted transitions");
    return promise;
  }, shouldNotHappen).then(shouldNotHappen, function(result) {
    ok(true, "failure handler called");
    start();
  });
});

asyncTest("transitionTo will soak up resolved parent models of active transition", function() {

  var admin = { id: 47 },
      adminPost = { id: 74 },
      adminPosts = [adminPost],
      lastAdminPromise,
      adminSetupShouldBeEntered = false;

  function adminPromise() {
    return lastAdminPromise = new RSVP.Promise(function(res) {
      res(admin);
    });
  }

  var adminHandler = {
    serialize: function(object) {
      equal(object.id, 47, "The object passed to serialize is correct");
      return { id: 47 };
    },

    model: function(params) {
      equal(params.id, 47, "The object passed to serialize is correct");
      return admin;
    },

    setup: function(model) {
      ok(adminSetupShouldBeEntered, "adminHandler's setup should be called at this time");
    }
  };

  var adminPostHandler = {
    serialize: function(object) {
      return { post_id: object.id };
    },

    setup: function(model) {
      equal(adminHandler.context, admin, "adminPostHandler receives resolved soaked promise from previous transition");
      start();
    },

    model: function(params) {
      return adminPost;
    }
  };

  var adminPostsHandler = {
    beforeModel: function() {
      adminSetupShouldBeEntered = true;
      router.transitionTo('adminPost', adminPost);
    }
  };

  var indexHandler = {
    setup: function() {
      ok(true, 'index entered');
    }
  };

  handlers = {
    index: indexHandler,
    admin: adminHandler,
    adminPost: adminPostHandler,
    adminPosts: adminPostsHandler
  };

  router.transitionTo('index').then(function(result) {
    router.transitionTo('adminPosts', adminPromise()).then(shouldNotHappen, assertAbort);
  });
});

asyncTest("transitionTo will soak up resolved all models of active transition, including present route's resolved model", function() {

  var modelCalled = 0,
      hasRedirected = false;

  map(function(match) {
    match("/post").to('post', function(match) {
      match("/").to('postIndex');
      match("/new").to('postNew');
    });
  });

  var postHandler = {
    model: function(params) {
      equal(modelCalled++, 0, "postHandler's model should only be called once");
      return { title: 'Hello world' };
    },

    afterModel: function(resolvedModel, transition) {
      if (!hasRedirected) {
        hasRedirected = true;
        router.transitionTo('postNew').then(start, shouldNotHappen);
      }
    }
  };

  handlers = {
    post: postHandler,
    postIndex: {},
    postNew: {}
  };

  router.transitionTo('postIndex').then(shouldNotHappen, assertAbort);
});


asyncTest("resolved models can be swapped out within afterModel", function() {

  var modelPre = {},
      modelPost = {};

  handlers = {
    index: {
      model: function() {
        return modelPre;
      },
      afterModel: function(resolvedModel, transition) {
        equal(resolvedModel, transition.resolvedModels.index, "passed-in resolved model equals model in transition's hash");
        equal(resolvedModel, modelPre, "passed-in resolved model equals model returned from `model`");
        transition.resolvedModels.index = modelPost;
      },
      setup: function(model) {
        equal(model, modelPost, "the model passed to `setup` is the one substituted in afterModel");
      }
    }
  };

  router.transitionTo('index').then(start);
});


asyncTest("String/number args in transitionTo are treated as url params", function() {

  expect(11);

  var adminParams = { id: "1" },
      adminModel = { id: "1" },
      adminPostModel = { id: "2" };

  handlers = {
    admin: {
      model: function(params) {
        deepEqual(params, adminParams, "admin handler gets the number passed in via transitionTo, converts to string");
        return adminModel;
      }
    },
    adminPost: {
      model: function(params) {
        deepEqual(params, { post_id: "2" }, "adminPost handler gets the string passed in via transitionTo");
        return adminPostModel;
      },
      setup: function() {
        ok(true, "adminPost setup was entered");
      }
    }
  };

  router.handleURL('/index').then(function() {
    expectedUrl = "/posts/admin/1/posts/2";
    return router.transitionTo('adminPost', 1, "2");
  }).then(function() {

    ok(router.isActive('adminPost', 1, "2"), "adminPost is active via params");
    ok(router.isActive('adminPost', 1, adminPostModel), "adminPost is active via contexts");

    adminParams = { id: "0" };
    expectedUrl = "/posts/admin/0/posts/2";
    return router.transitionTo('adminPost', 0, "2");
  }).then(function() {
    ok(router.isActive('adminPost', 0, "2"), "adminPost is active via params");
    ok(router.isActive('adminPost', 0, adminPostModel), "adminPost is active via contexts");

    start();
  }, shouldNotHappen);
});

asyncTest("Transitions returned from beforeModel/model/afterModel hooks aren't treated as pausing promises", function(){

  expect(6);

  handlers = {
    index: {
      beforeModel: function() {
        ok(true, 'index beforeModel called');
        return router.transitionTo('index');
      },
      model: function(){
        ok(true, 'index model called');
        return router.transitionTo('index');
      },
      afterModel: function(){
        ok(true, 'index afterModel called');
        return router.transitionTo('index');
      }
    }
  };

  function testStartup(){
    map(function(match) {
      match("/index").to('index');
    });

    return router.handleURL('/index');
  }

  testStartup().then(function(result) {
    delete handlers.index.beforeModel;
    return testStartup();
  }).then(function(result) {
    delete handlers.index.model;
    return testStartup();
  }).then(function(result) {
    delete handlers.index.afterModel;
    return testStartup();
  }).then(function(result) {
    start();
  });

});


asyncTest("Redirect back to the present route doesn't update URL", function() {

  expect(2);

  handlers = {

    index: {
      setup: function() {
        ok(true, "index was entered");
      }
    },

    about: {
      beforeModel: function() {
        router.transitionTo('index');
      }
    }
  };

  var didTransitionCount = 0;
  router.didTransition = function(infos) {
    didTransitionCount++;
  };

  router.updateURL = function() {
    ok(false, "Should not update the URL");
  };

  router.handleURL('/index').then(function() {
    return router.transitionTo('about');
  }).then(shouldNotHappen, function() {
    equal(didTransitionCount, 2, "didTransition was called twice");
    start();
  });
});


asyncTest("A failed handler's setup shouldn't prevent future transitions", function() {

  expect(2);

  map(function(match) {
    match("/parent").to('parent', function(match) {
      match("/articles").to('articles');
      match("/login").to('login');
    });
  });

  handlers = {
    articles: {
      setup: function() {
        ok(true, "articles setup was entered");
        throw new Error(("blorg"));
      },
      events: {
        error: function() {
          ok(true, "error handled in articles");
          router.transitionTo('login');
        }
      }
    },

    login: {
      setup: function() {
        start();
      }
    }
  };

  router.handleURL('/parent/articles');
});


module("Preservation of params between redirects", {
  setup: function() {
    expectedUrl = null;

    map(function(match) {
      match("/").to('index');
      match("/:foo_id").to("foo", function(match) {
        match("/").to("fooIndex");
        match("/:bar_id").to("bar", function(match) {
          match("/").to("barIndex");
        });
      });
    });

    handlers = {
      foo: {
        model: function(params) {
          this.modelCount = this.modelCount ? this.modelCount + 1 : 1;
          return { id: params.foo_id };
        },
        afterModel: function(_, transition) {
          router.transitionTo('barIndex', '789');
        }
      },

      bar: {
        model: function(params) {
          this.modelCount = this.modelCount ? this.modelCount + 1 : 1;
          return { id: params.bar_id };
        }
      }
    };
  }
});

asyncTest("Starting on '/' root index", function() {
  router.handleURL('/').then(function() {
    expectedUrl = "/123/789";

    // Should call model for foo and bar
    return router.transitionTo('barIndex', '123', '456');
  }, shouldNotHappen).then(shouldNotHappen, followRedirect).then(function() {

    equal(handlers.foo.modelCount, 1, "redirect in foo#afterModel should not re-run foo#model");

    deepEqual(handlers.foo.context, { id: '123' });
    deepEqual(handlers.bar.context, { id: '789' }, "bar should have redirected to bar 789");

    // Try setting foo's context to 200; this should redirect
    // bar to '789' but preserve the new foo 200.
    expectedUrl = "/200/789";
    return router.transitionTo('fooIndex', '200');
  }, shouldNotHappen).then(shouldNotHappen, followRedirect).then(function() {

    equal(handlers.foo.modelCount, 2, "redirect in foo#afterModel should not re-run foo#model");

    deepEqual(handlers.foo.context, { id: '200' });
    deepEqual(handlers.bar.context, { id: '789' }, "bar should have redirected to bar 789");
    start();
  });
});

asyncTest("Starting on non root index", function() {
  router.handleURL('/123/456').then(shouldNotHappen, followRedirect).then(function() {
    deepEqual(handlers.foo.context, { id: '123' });
    deepEqual(handlers.bar.context, { id: '789' }, "bar should have redirected to bar 789");

    // Try setting foo's context to 200; this should redirect
    // bar to '789' but preserve the new foo 200.
    expectedUrl = "/200/789";
    return router.transitionTo('fooIndex', '200');
  }, shouldNotHappen).then(shouldNotHappen, followRedirect).then(function() {

    deepEqual(handlers.foo.context, { id: '200' });
    deepEqual(handlers.bar.context, { id: '789' }, "bar should have redirected to bar 789");
    start();
  });
});
