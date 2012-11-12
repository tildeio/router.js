QUnit.config.testTimeout = 100;

var router, url, handlers;

module("The router", {
  setup: function() {
    router = new Router();

    router.map(function(match) {
      match("/posts", function(match) {
        match("/:id").to("showPost");
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
    }
  }    
});

test("Mapping adds named routes to the end", function() {
  url = router.generate("showPost", { id: 1 });
  equal(url, "/posts/1");

  url = router.generate("showAllPosts");
  equal(url, "/posts");
});

asyncTest("Handling a URL triggers deserialize on the handlerand passes the result into the setup method", function() {
  expect(3);

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
      start();
    }
  };

  var postIndexHandler = {};

  handlers = {
    showPost: showPostHandler,
    postIndex: postIndexHandler
  };

  router.handleURL("/posts/1");
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
        start();
      } else {
        ok(false, "Should not get here");
      }
    }
  };


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

    serialize: function(object) {
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

    serialize: function(object) {
      return {};
    },

    setup: function(object) {
      strictEqual(object, allPosts);
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
      strictEqual(object, popularPosts);
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

    serialize: function(object) {
      return { filter_id: object.filter };
    },

    setup: function(object) {
      if (counter === 2) {
        strictEqual(object, amazingPosts);
      } else if (counter === 3) {
        strictEqual(object, sadPosts);
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

    equal(url, expected[counter]);
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

