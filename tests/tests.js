QUnit.config.testTimeout = 1000;

var bb = new backburner.Backburner(['promises']);

function customAsync(callback, promise) {
  bb.defer('promises', promise, callback, promise);
}

function flushBackburner() {
  bb.end();
  bb.begin();
}

// Helper method that performs a transition and flushes
// the backburner queue. Helpful for when you want to write
// tests that avoid .then callbacks.
function transitionTo() {
  router.transitionTo.apply(router, arguments);
  flushBackburner();
}

function transitionToWithAbort() {
  router.transitionTo.apply(router, arguments).then(shouldNotHappen, function(reason) {
    equal(reason.name, "TransitionAborted", "transition was redirected/aborted");
  });
  flushBackburner();
}

var router, url, handlers, expectedUrl,
    actions;

module("The router", {
  setup: function() {

    RSVP.configure('async', customAsync);
    bb.begin();

    handlers = {};
    expectedUrl = null;

    map(function(match) {
      match("/index").to("index").withQueryParams('sort', 'filter');
      match("/about").to("about");
      match("/faq").to("faq");
      match('/nested').to('nestedParent', function (match) {
        match('/').to('nestedChild').withQueryParams('childParam');
      }).withQueryParams('parentParam');
      match("/posts", function(match) {
        match("/:id").to("showPost").withQueryParams('foo', 'bar');
        match("/on/:date").to("showPostsForDate");
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
  },
  teardown: function() {
    bb.end();
  }
});

test("backburnerized testing works as expected", function() {
  expect(1);
  RSVP.resolve("hello").then(function(word) {
    equal(word, "hello", "backburner flush in teardown resolved this promise");
  });
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

function shouldBeTransition (object) {
  ok(object.toString().match(/Transition \(sequence \d+\)/), "Object should be transition");
}

function enableErrorHandlingDeferredActionQueue() {

  actions = [];
  RSVP.configure('async', function(callback, promise) {
    actions.push({
      callback: callback,
      promise: promise
    });
  });
}

function flush(expectedError) {
  try {
    while(actions.length) {
      var action = actions.shift();
      action.callback.call(action.promise, action.promise);
    }
  } catch(e) {
    equal(e, expectedError, "exception thrown from hook wasn't swallowed");
    actions = [];
  }
}

test("Mapping adds named routes to the end", function() {
  url = router.recognizer.generate("showPost", { id: 1 });
  equal(url, "/posts/1");

  url = router.recognizer.generate("showAllPosts");
  equal(url, "/posts");
});

test("Handling an invalid URL returns a rejecting promise", function() {
  router.handleURL("/unknown").then(shouldNotHappen, function(e) {
    ok(e instanceof Router.UnrecognizedURLError, "rejects with UnrecognizedURLError");
    ok(e.name, "UnrecognizedURLError", "error.name is UnrecognizedURLError");
  }, shouldNotHappen);
});

function routePath(infos) {
  var path = [];

  for (var i=0, l=infos.length; i<l; i++) {
    path.push(infos[i].name);
  }

  return path.join(".");
}

test("Handling a URL triggers model on the handler and passes the result into the setup method", function() {
  expect(4);

  var post = { post: true };
  var posts = { index: true };

  handlers = {
    showPost: {
      model: function(params) {
        deepEqual(params, { id: "1" }, "showPost#model called with id 1");
        return post;
      },

      setup: function(object) {
        strictEqual(object, post, "setup was called with expected model");
        equal(handlers.showPost.context, post, "context was properly set on showPost handler");
      }
    }
  };

  router.didTransition = function(infos) {
    equal(routePath(infos), "showPost");
  };

  router.handleURL("/posts/1");
});

test("Handling a URL passes in query params", function() {
  return;
  expect(2);

  var indexHandler = {
    model: function(params, queryParams, transition) {
      deepEqual(queryParams, { sort: 'date', filter: true });
    },

    setup: function(object, queryParams) {
      deepEqual(queryParams, { sort: 'date', filter: true });
    }
  };

  handlers = {
    index: indexHandler
  };

  router.handleURL("/index?sort=date&filter");
});

test("handleURL accepts slash-less URLs", function() {

  handlers = {
    showAllPosts: {
      setup: function() {
        ok(true, "showAllPosts' setup called");
      }
    }
  };

  router.handleURL("posts/all");
});

test("Can get query params for a handler", function () {
  return;
  deepEqual(router.queryParamsForHandler('nestedChild'), ["parentParam", "childParam"], "Correct query params for child");
});

test("handleURL accepts query params", function() {
  return;

  handlers = {
    posts: {},
    postIndex: {},
    showAllPosts: {
      setup: function() {
        ok(true, "showAllPosts' setup called");
      }
    }
  };

  router.handleURL("/posts/all?sort=name&sortDirection=descending");
});

test("isActive respects query params", function() {
  return;
  expect(10);

  transitionTo('/index');

  ok(router.isActive('index'), 'Index should be active');
  ok(router.isActive('index', {queryParams: {}}), 'Index should be active');
  ok(router.isActive('index', {queryParams: {sort: false}}), 'Index should be active');
  ok(router.isActive('index', {queryParams: false}), 'Index should be active with no query params');
  ok(!router.isActive('index', {queryParams: {sort: 'name'}}), 'Index should not be active with query params');

  transitionTo("/index?sort=name");

  ok(router.isActive('index'), 'Index should be active');
  ok(router.isActive('index', {queryParams: {sort: 'name'}}), 'Index should be active');
  ok(router.isActive('index', {queryParams: {}}), 'Index should be active');
  ok(!router.isActive('index', {queryParams: false}), 'Index should not be active with no query params');
  ok(!router.isActive('index', {queryParams: {sort: false}}), 'Index should not be active without queryParams');
});

test("when transitioning with the same context, setup should only be called once", function() {
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

  transitionTo('/');

  equal(parentSetupCount, 0, 'precond - parent not setup');
  equal(childSetupCount, 0, 'precond - parent not setup');

  transitionTo('postDetails', context);

  equal(parentSetupCount, 1, 'after one transition parent is setup once');
  equal(childSetupCount, 1, 'after one transition child is setup once');

  transitionTo('postDetails', context);

  equal(parentSetupCount, 1, 'after two transitions, parent is still setup once');
  equal(childSetupCount, 1, 'after two transitions, child is still setup once');
});

test("setup should be called when query params change", function() {
  return;
  expect(64);

  var parentBeforeModelCount      = 0,
      parentModelCount            = 0,
      parentAfterModelCount       = 0,
      parentSetupCount            = 0,
      childBeforeModelCount       = 0,
      childModelCount             = 0,
      childAfterModelCount        = 0,
      childSetupCount             = 0;

  var context = { id: 1 };

  router = new Router();

  router.map(function(match) {
    match("/").to('index');
    match("/posts/:id").to('post', function(match) {
      match("/details").to('postDetails').withQueryParams('expandedPane', 'author');
    }).withQueryParams('sort');
  });

  router.getHandler = function(name) {
    return handlers[name];
  };

  router.updateURL = function() {};

  var indexHandler = {
    beforeModel: function (transition) {
      shouldBeTransition(transition);
    },

    model: function(params, transition) {
      shouldBeTransition(transition);
      return context;
    },

    afterModel: function (resolvedModel, transition) {
      shouldBeTransition(transition);
    },

    setup: function(object, queryParams) {
      ok(!queryParams, "Index should not have query params");
      equal(object, context);
    }

  };

  var postHandler = {
    beforeModel: function (queryParams, transition) {
      if(parentBeforeModelCount === 0) {
        deepEqual(queryParams, {}, "Post should not have query params");
      } else if (parentBeforeModelCount === 1) {
        deepEqual(queryParams, {sort: 'name'}, 'Post should have sort param');
      }
      parentBeforeModelCount++;
    },

    model: function(params, queryParams, transition) {
      if(parentModelCount === 0) {
        deepEqual(queryParams, {}, "Post should not have query params");
      } else if (parentModelCount === 1) {
        deepEqual(queryParams, {sort: 'name'}, 'Post should have sort param');
      }
      parentModelCount++;
      return context;
    },

    afterModel: function (resolvedModel, queryParams, transition) {
      if(parentAfterModelCount === 0) {
        deepEqual(queryParams, {}, "Post should not have query params");
      } else if (parentAfterModelCount === 1) {
        deepEqual(queryParams, {sort: 'name'}, 'Post should have sort param');
      }
      parentAfterModelCount++;

    },

    setup: function(object, queryParams) {
      if(parentSetupCount === 0) {
        deepEqual(queryParams, {}, "Post should not have query params");
      } else if (parentSetupCount === 1) {
        deepEqual(queryParams, {sort: 'name'}, 'Post should have sort param');
      }
      equal(object, context);
      parentSetupCount++;
    },

    serialize: function (model) {
      return {id: model.id};
    }
  };

  var postDetailsHandler = {
    beforeModel: function(queryParams, transition) {
      var paramValue = childBeforeModelCount === 0 ? 'related' : 'author';
      deepEqual(queryParams, {expandedPane: paramValue}, 'postDetails should have expandedPane param');
      childBeforeModelCount++;
    },

    model: function(params, queryParams, transition) {
      var paramValue = childModelCount === 0 ? 'related' : 'author';
      deepEqual(queryParams, {expandedPane: paramValue}, 'postDetails should have expandedPane param');
      childModelCount++;
    },

    afterModel: function(resolvedModel, queryParams, transition) {
      var paramValue = childAfterModelCount === 0 ? 'related' : 'author';
      deepEqual(queryParams, {expandedPane: paramValue}, 'postDetails should have expandedPane param');
      childAfterModelCount++;
    },


    setup: function(context, queryParams) {
      var paramValue = childSetupCount === 0 ? 'related' : 'author';
      deepEqual(queryParams, {expandedPane: paramValue}, 'postDetails should have expandedPane param');
      childSetupCount++;
    }
  };

  handlers = {
    index: indexHandler,
    post: postHandler,
    postDetails: postDetailsHandler
  };

  transitionTo('index');
  deepEqual(router.currentQueryParams, {}, "Router has correct query params");
  equal(parentSetupCount, 0, 'precond - parent not setup');
  equal(parentModelCount, 0, 'precond - parent not modelled');
  equal(childSetupCount, 0, 'precond - child not setup');
  equal(childModelCount, 0, 'precond - child not modelled');

  transitionTo('postDetails', {queryParams: {expandedPane: 'related'}});

  deepEqual(router.currentQueryParams, {expandedPane: 'related'}, "Router has correct query params");
  equal(parentSetupCount, 1, 'after one transition parent is setup once');
  equal(parentModelCount, 1, 'after one transition parent is modelled once');
  equal(childSetupCount, 1, 'after one transition child is setup once');
  equal(childModelCount, 1, 'after one transition child is modelled once');

  equal(router.generate('postDetails'), "/posts/1/details?expandedPane=related", "Query params are sticky");
  equal(router.generate('postDetails', {queryParams: false}), "/posts/1/details", "Can clear query params");
  equal(router.generate('postDetails', {queryParams: {expandedPane: 'author'}}), "/posts/1/details?expandedPane=author", "Query params are overridable");
  equal(router.generate('index'), "/", 'Query params only sticky to routes that observe them');
  equal(router.generate('index', {queryParams: false}), "/", "Clearing non existent query params works");

  throws(function() {
    router.generate('index', {queryParams: {foo: 'bar'}});
  }, /You supplied the params "foo=bar" which are not valid for the "index" handler or its parents/, "should throw correct error for one wrong param");

  throws(function() {
    router.generate('index', {queryParams: {foo: 'bar', baz: 'qux'}});
  }, /You supplied the params "foo=bar" and "baz=qux" which are not valid for the "index" handler or its parents/, "should throw correct error for one wrong param");

  transitionTo('postDetails', {queryParams: {expandedPane: 'author'}});

  deepEqual(router.currentQueryParams, {expandedPane: 'author'}, "Router has correct query params");
  equal(parentSetupCount, 1, 'after two transitions, parent is setup once');
  equal(parentModelCount, 1, 'after two transitions parent is modelled once');
  equal(childSetupCount, 2, 'after two transitions, child is setup twice');
  equal(childModelCount, 2, 'after two transitions, child is modelled twice');

  transitionTo('postDetails');

  deepEqual(router.currentQueryParams, {expandedPane: 'author'}, "Router has correct query params");
  // transitioning again without query params should assume old query params, so the handlers
  // shouldn't be called again
  equal(parentSetupCount, 1, 'after three transitions, parent is setup once');
  equal(parentModelCount, 1, 'after three transitions parent is modelled once');
  equal(childSetupCount, 2, 'after three transitions, child is setup twice');
  equal(childModelCount, 2, 'after three transitions, child is modelled twice');

  // not providing a route name should assume the current route
  transitionTo({queryParams: {sort: 'name', expandedPane: 'author'}});

  deepEqual(router.currentQueryParams, {sort: 'name', expandedPane: 'author'}, "Router has correct query params");
  equal(parentSetupCount, 2, 'after four transitions, parent is setup twice');
  equal(parentModelCount, 2, 'after four transitions, parent is modelled twice');
  equal(childSetupCount, 3, 'after four transitions, child is setup thrice');
  equal(childModelCount, 3, 'after four transitions, child is modelled thrice');

  transitionTo('postDetails', {queryParams: {sort: 'name'}});

  deepEqual(router.currentQueryParams, {sort: 'name', expandedPane: 'author'}, "Router has correct query params");
  equal(parentSetupCount, 2, 'after five transitions, parent is setup twice');
  equal(parentModelCount, 2, 'after five transitions, parent is modelled twice');
  equal(childSetupCount, 3, 'after five transitions, child is setup thrice');
  equal(childModelCount, 3, 'after five transitions, child is modelled thrice');
});



test("when transitioning with the same query params, setup should only be called once", function() {
  return;
  expect(15);
  var parentSetupCount = 0,
      childSetupCount = 0;

  var context = { id: 1 };

  router = new Router();

  router.map(function(match) {
    match("/").to('index').withQueryParams('sort', 'direction');
    match("/posts/:id").to('post', function(match) {
      match("/details").to('postDetails').withQueryParams('expandedPane', 'author');
    });
  });

  router.getHandler = function(name) {
    return handlers[name];
  };

  router.updateURL = function() {};

  var indexHandler = {
    setup: function(context, queryParams) {
      deepEqual(queryParams, {sort: 'author'}, 'index should have sort param');
    },

    model: function(params, queryParams, transition) {
      deepEqual(queryParams, {sort: 'author'}, 'index should have sort param');
    }

  };

  var postHandler = {
    setup: function(context, queryParams) {
      ok(!queryParams, "Post should not have query params");
      parentSetupCount++;
    },

    model: function(params, transition) {
      shouldBeTransition(transition);
      return params;
    }
  };

  var postDetailsHandler = {
    setup: function(context, queryParams) {
      childSetupCount++;
      deepEqual(queryParams, {expandedPane: 'related'}, 'postDetails should have expandedPane param');
    },

    model: function(params, queryParams, transition) {
      deepEqual(queryParams, {expandedPane: 'related'}, 'postDetails should have expandedPane param');
    }
  };

  handlers = {
    index: indexHandler,
    post: postHandler,
    postDetails: postDetailsHandler
  };

  transitionTo('/?sort=author');
  deepEqual(router.currentQueryParams, {sort: 'author'}, "Router has correct query params");
  equal(parentSetupCount, 0, 'precond - parent not setup');
  equal(childSetupCount, 0, 'precond - parent not setup');

  transitionTo('postDetails', context, {queryParams: {expandedPane: 'related'}});

  deepEqual(router.currentQueryParams, {expandedPane: 'related'}, "Router has correct query params");
  equal(parentSetupCount, 1, 'after one transition parent is setup once');
  equal(childSetupCount, 1, 'after one transition child is setup once');

  transitionTo('postDetails', context, {queryParams: {expandedPane: 'related'}});

  deepEqual(router.currentQueryParams, {expandedPane: 'related'}, "Router has correct query params");
  equal(parentSetupCount, 1, 'after two transitions, parent is still setup once');
  equal(childSetupCount, 1, 'after two transitions, child is still setup once');
});



test("Having query params defined on a route should affect the order of params passed in to the model hooks", function() {
  return;
  expect(13);

  var context = { id: 1 };

  router = new Router();

  router.map(function(match) {
    match("/").to('index').withQueryParams('sort', 'direction');
    match("/posts/:id").to('post');
  });

  router.getHandler = function(name) {
    return handlers[name];
  };

  router.updateURL = function() {};

  var indexHandler = {
    beforeModel: function (queryParams, transition) {
      deepEqual(queryParams, {sort: 'author'}, 'index should have sort param');
      shouldBeTransition(transition);
    },

    model: function(params, queryParams, transition) {
      deepEqual(params, {}, "params should be blank on index");
      deepEqual(queryParams, {sort: 'author'}, 'index should have sort param');
      shouldBeTransition(transition);
      return [context];
    },

    afterModel: function (model, queryParams, transition) {
      deepEqual(model, [context], "Index should have correct model");
      deepEqual(queryParams, {sort: 'author'}, 'index should have sort param');
      shouldBeTransition(transition);
    }

  };

  var postHandler = {
    beforeModel: function (transition) {
      shouldBeTransition(transition);
    },

    model: function(params, transition) {
      deepEqual(params, {id: '1'});
      shouldBeTransition(transition);
      return context;
    },

    afterModel: function (model, transition) {
      equal(model, context);
      shouldBeTransition(transition);
    }
  };

  handlers = {
    index: indexHandler,
    post: postHandler
  };

  transitionTo('/?sort=author');
  transitionTo('/posts/1');
});

test("Sticky query params should be shared among routes", function() {
  return;
  expect(78);
  var context = { id: 1 }, expectedIndexParams, expectedPostsParams, currentURL;

  router = new Router();

  router.map(function(match) {
    match("/").to('index').withQueryParams('sort', 'direction');
    match("/posts").to('posts').withQueryParams('sort', 'direction', 'filter');
  });

  router.getHandler = function(name) {
    return handlers[name];
  };

  router.updateURL = function(url) { currentURL = url; };

  var indexHandler = {
    beforeModel: function (queryParams, transition) {
      deepEqual(queryParams, expectedIndexParams, "Correct query params in index beforeModel");
    },

    model: function(params, queryParams, transition) {
      deepEqual(queryParams, expectedIndexParams, "Correct query params in index model");
    },

    afterModel: function (resolvedModel, queryParams, transition) {
      deepEqual(queryParams, expectedIndexParams, "Correct query params in index afterModel");
    },

    setup: function(context, queryParams) {
      deepEqual(queryParams, expectedIndexParams, "Correct query params in index setup");
    }
  };

  var postsHandler = {
    beforeModel: function (queryParams, transition) {
      deepEqual(queryParams, expectedPostsParams, "Correct query params in posts beforeModel");
    },

    model: function(params, queryParams, transition) {
      deepEqual(queryParams, expectedPostsParams, "Correct query params in posts model");
    },

    afterModel: function (resolvedModel, queryParams, transition) {
      deepEqual(queryParams, expectedPostsParams, "Correct query params in posts afterModel");
    },

    setup: function(context, queryParams) {
      deepEqual(queryParams, expectedPostsParams, "Correct query params in posts setup");
    }
  };


  handlers = {
    index: indexHandler,
    posts: postsHandler
  };

  expectedIndexParams = {sort: 'author'};

  transitionTo('/?sort=author');

  deepEqual(router.currentQueryParams, {sort: 'author'}, "Router has correct query params");
  equal(router.generate('index'), "/?sort=author", "Route generated correctly");
  equal(router.generate('posts'), "/posts?sort=author", "Route generated correctly");
  equal(router.generate('index', {queryParams: {sort: false}}), "/", "Route generated correctly");
  equal(router.generate('posts', {queryParams: {sort: false}}), "/posts", "Route generated correctly");
  equal(router.generate('index', {queryParams: {sort: true}}), "/?sort", "Route generated correctly");
  equal(router.generate('posts', {queryParams: {sort: true}}), "/posts?sort", "Route generated correctly");

  raises(function () {
    router.generate('index', {queryParams: {filter: 'foo'}});
  }, "No filter param on index");

  expectedPostsParams = {sort: 'author'};

  transitionTo('posts');

  equal(currentURL, '/posts?sort=author', "URL is correct after transition");
  deepEqual(router.currentQueryParams, {sort: 'author'}, "Router has correct query params");
  equal(router.generate('index'), "/?sort=author", "Route generated correctly");
  equal(router.generate('posts'), "/posts?sort=author", "Route generated correctly");
  equal(router.generate('index', {queryParams: {sort: false}}), "/", "Route generated correctly");
  equal(router.generate('posts', {queryParams: {sort: false}}), "/posts", "Route generated correctly");
  equal(router.generate('index', {queryParams: {sort: true}}), "/?sort", "Route generated correctly");
  equal(router.generate('posts', {queryParams: {sort: true}}), "/posts?sort", "Route generated correctly");

  expectedPostsParams = {sort: 'author', filter: 'published'};
  transitionTo({queryParams: {filter: 'published'}});

  equal(currentURL, '/posts?sort=author&filter=published', "URL is correct after transition");
  deepEqual(router.currentQueryParams, {sort: 'author', filter: 'published'}, "Router has correct query params");

  equal(router.generate('index'), "/?sort=author", "Route generated correctly");
  equal(router.generate('posts'), "/posts?sort=author&filter=published", "Route generated correctly");
  equal(router.generate('index', {queryParams: {sort: false}}), "/", "Route generated correctly");
  equal(router.generate('posts', {queryParams: {sort: false}}), "/posts?filter=published", "Route generated correctly");
  equal(router.generate('index', {queryParams: {sort: true}}), "/?sort", "Route generated correctly");
  equal(router.generate('posts', {queryParams: {sort: true}}), "/posts?sort&filter=published", "Route generated correctly");

  transitionTo('index');

  equal(currentURL, '/?sort=author', "URL is correct after transition");
  deepEqual(router.currentQueryParams, {sort: 'author'}, "Router has correct query params");

  equal(router.generate('index'), "/?sort=author", "Route generated correctly");
  equal(router.generate('posts'), "/posts?sort=author", "Route generated correctly");
  equal(router.generate('index', {queryParams: {sort: false}}), "/", "Route generated correctly");
  equal(router.generate('posts', {queryParams: {sort: false}}), "/posts", "Route generated correctly");
  equal(router.generate('index', {queryParams: {sort: true}}), "/?sort", "Route generated correctly");
  equal(router.generate('posts', {queryParams: {sort: true}}), "/posts?sort", "Route generated correctly");

  expectedIndexParams = {};
  transitionTo('/');

  equal(currentURL, '/', "Transitioning by URL sets all query params");
  deepEqual(router.currentQueryParams, {}, "Router has correct query params");

  expectedIndexParams = {sort: 'author'};
  transitionTo('/?sort=author');

  equal(currentURL, '/?sort=author', "Query params are back");
  deepEqual(router.currentQueryParams, {sort: 'author'}, "Router has correct query params");

  expectedIndexParams = {};
  transitionTo({queryParams: false});

  equal(currentURL, '/', "Query params are cleared by queryParams: false");
  deepEqual(router.currentQueryParams, {}, "Router has correct query params");

  expectedIndexParams = {sort: 'author'};
  transitionTo('/?sort=author');

  equal(currentURL, '/?sort=author', "Query params are back");
  deepEqual(router.currentQueryParams, {sort: 'author'}, "Router has correct query params");

  expectedIndexParams = {};
  transitionTo('index', {queryParams: false});

  equal(currentURL, '/', "Query params are cleared by queryParams: false with named route");
  deepEqual(router.currentQueryParams, {}, "Router has correct query params");
});


test("retrying should work with queryParams", function () {
  return;
  expect(1);
  var context = { id: 1 };
  var shouldAbort = true;

  router = new Router();

  router.map(function(match) {
    match("/").to('index').withQueryParams('sort', 'direction');
    match("/posts/:id").to('post', function(match) {
      match("/details").to('postDetails').withQueryParams('expandedPane', 'author');
    });
  });

  router.getHandler = function(name) {
    return handlers[name];
  };

  router.updateURL = function() {};

  var indexHandler = {
    setup: function(context, queryParams) {
    }
  };

  var postHandler = {
    beforeModel: function(transition) {
      if(shouldAbort) {
        shouldAbort = false;
        transition.abort();
        transition.retry();
      }
    }
  };

  var postDetailsHandler = {
    setup: function(context, queryParams) {
      deepEqual(queryParams, {expandedPane: 'related'}, 'postDetails should have expandedPane param');
    }
  };

  handlers = {
    index: indexHandler,
    post: postHandler,
    postDetails: postDetailsHandler
  };

  router.handleURL('/').then(function() {
    return router.transitionTo('postDetails', context, {queryParams: {expandedPane: 'related'}});
  });
});

test("query params should be considered to decide if a transition is identical", function () {
  return;
  expect(3);
  var context = { id: 1 };

  router = new Router();

  router.map(function(match) {
    match("/").to('index').withQueryParams('sort', 'direction');
    match("/posts/:id").to('post', function(match) {
      match("/details").to('postDetails').withQueryParams('expandedPane', 'author');
    });
  });

  router.getHandler = function(name) {
    return handlers[name];
  };

  router.updateURL = function() {};

  var indexHandler = {};

  var postHandler = {};

  var postDetailsHandler = {};

  handlers = {
    index: indexHandler,
    post: postHandler,
    postDetails: postDetailsHandler
  };

  router.handleURL('/').then(function() {
    var firstTransition  = router.transitionTo('postDetails', context, {queryParams: {expandedPane: 'related'}});
    var secondTransition = router.transitionTo('postDetails', context, {queryParams: {expandedPane: 'related'}});
    equal(firstTransition, secondTransition);
    return secondTransition;
  }, shouldNotHappen).then(function () {
    var firstTransition  = router.transitionTo('postDetails', context, {queryParams: {expandedPane: 'related'}});
    var secondTransition = router.transitionTo('postDetails', context, {queryParams: {expandedPane: 'author'}});
    notEqual(firstTransition, secondTransition);
    ok(firstTransition.isAborted, "The first transition should be aborted");
    return secondTransition;
  }, shouldNotHappen).then(function () {
    start();
  });
});


//RSVP reported unhandled errors. Please match sure to provide an error handler for every promise
test("retrying should work with queryParams and a URL transition", function () {
  return;
  expect(1);
  var context = { id: 1 };
  var shouldAbort = true;

  router = new Router();

  router.map(function(match) {
    match("/").to('index').withQueryParams('sort', 'direction');
    match("/posts/:id").to('post', function(match) {
      match("/details").to('postDetails').withQueryParams('expandedPane', 'author');
    });
  });

  router.getHandler = function(name) {
    return handlers[name];
  };

  router.updateURL = function() {};

  var indexHandler = {
    setup: function(context, queryParams) {
    }
  };

  var postHandler = {
    beforeModel: function(transition) {
      if(shouldAbort) {
        shouldAbort = false;
        transition.abort();
        transition.retry();
      }
    }
  };

  var postDetailsHandler = {
    setup: function(context, queryParams) {
      deepEqual(queryParams, {expandedPane: 'related'}, 'postDetails should have expandedPane param');
    }
  };

  handlers = {
    index: indexHandler,
    post: postHandler,
    postDetails: postDetailsHandler
  };

  router.handleURL('/').then(function() {
    return router.transitionTo('/posts/1/details?expandedPane=related');
  });
});


test("when transitioning to a new parent and child state, the parent's context should be available to the child's model", function() {
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
  }, shouldNotHappen);
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
  };

  router.handleURL("/posts").then(function() {
    deepEqual(handlers, [ "application", "posts", "posts.index" ]);
  });
});

test("handleURL: Handling a nested URL triggers each handler", function() {
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
  }, shouldNotHappen);
});

test("it can handle direct transitions to named routes", function() {
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
  }, shouldNotHappen);
});

test("replaceWith calls replaceURL", function() {
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
  });
});


test("Moving to a new top-level route triggers exit callbacks", function() {
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
  }, shouldNotHappen);
});

test("pivotHandler is exposed on Transition object", function() {
  expect(3);

  handlers = {
    showAllPosts: {
      beforeModel: function(transition) {
        ok(!transition.pivotHandler, "First route transition has no pivot route");
      }
    },

    showPopularPosts: {
      beforeModel: function(transition) {
        equal(transition.pivotHandler, handlers.postIndex, "showAllPosts -> showPopularPosts pivotHandler is postIndex");
      }
    },

    postIndex: {},

    about: {
      beforeModel: function(transition) {
        ok(!transition.pivotHandler, "top-level transition has no pivotHandler");
      }
    }
  };

  router.handleURL("/posts").then(function() {
    return router.transitionTo('showPopularPosts');
  }).then(function() {
    return router.transitionTo('about');
  }).then(start, shouldNotHappen);
});

test("Moving to the same route with a different parent dynamic segment re-runs model", function() {
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

  transitionTo("/posts/admin/1/posts");
  equal(handlers.admin.context, admins[1]);
  equal(handlers.adminPosts.context, adminPosts[1]);

  transitionTo("/posts/admin/2/posts");
  equal(handlers.admin.context, admins[2]);
  equal(handlers.adminPosts.context, adminPosts[2]);
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

test("Moving to a sibling route only triggers exit callbacks on the current route (when transitioned via a URL change)", function() {
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

  flushBackburner();

  expectedUrl = "/posts/filter/favorite";
  router.handleURL(expectedUrl);
});

test("events can be targeted at the current handler", function() {

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

  transitionTo('/posts/1');

  router.trigger("expand");
});

test("event triggering is pluggable", function() {

  handlers = {
    showPost: {
      enter: function() {
        ok(true, "The show post handler was entered");
      },

      actions: {
        expand: function() {
          equal(this, handlers.showPost, "The handler is the `this` for the event");
        }
      }
    }
  };
  router.triggerEvent = function(handlerInfos, ignoreFailure, args) {
    var name = args.shift();

    if (!handlerInfos) {
      if (ignoreFailure) { return; }
      throw new Error("Could not trigger event '" + name + "'. There are no active handlers");
    }

    var eventWasHandled = false;

    for (var i=handlerInfos.length-1; i>=0; i--) {
      var handlerInfo = handlerInfos[i],
          handler = handlerInfo.handler;

      if (handler.actions && handler.actions[name]) {
        if (handler.actions[name].apply(handler, args) === true) {
          eventWasHandled = true;
        } else {
          return;
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

test("events can be targeted at a parent handler", function() {
  expect(3);

  handlers = {
    postIndex: {
      enter: function() {
        ok(true, "The post index handler was entered");
      },

      events: {
        expand: function() {
          equal(this, handlers.postIndex, "The handler is the `this` in events");
        }
      }
    },
    showAllPosts: {
      enter: function() {
        ok(true, "The show all posts handler was entered");
      }
    }
  };

  transitionTo('/posts');
  router.trigger("expand");
});

test("events can bubble up to a parent handler via `return true`", function() {
  expect(4);

  handlers = {
    postIndex: {
      enter: function() {
        ok(true, "The post index handler was entered");
      },

      events: {
        expand: function() {
          equal(this, handlers.postIndex, "The handler is the `this` in events");
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

test("handled-then-bubbled events don't throw an exception if uncaught by parent route", function() {
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
          return true;
        }
      }
    }
  };

  transitionTo("/posts");
  router.trigger("expand");
});

test("events only fire on the closest handler", function() {
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
        }
      }
    }
  };

  var context1 = {}, context2 = {};
  router.handleURL("/posts").then(function(result) {
    router.trigger("expand", context1, context2);
  });
});

test("Date params aren't treated as string/number params", function() {
  expect(1);

  handlers = {
    showPostsForDate: {
      serialize: function(date) {
        return { date: date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate() };
      },

      model: function(params) {
        ok(false, "model shouldn't be called; the date is the provided model");
      }
    }
  };

  equal(router.generate('showPostsForDate', new Date(1815, 5, 18)), "/posts/on/1815-5-18");
});

test("transitionTo uses the current context if you are already in a handler with a context that is not changing", function() {
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
  transitionTo('adminPost', admin, adminPost);

  expectedUrl =  '/posts/admin/47/posts/75';
  transitionTo('adminPost', { id: 75 });
});

test("tests whether arguments to transitionTo are considered active", function() {
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
      return object && { id: object.id } || null;
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

  transitionTo("/posts/1");
  ok(router.isActive('showPost'), "The showPost handler is active");
  ok(router.isActive('showPost', posts[1]), "The showPost handler is active with the appropriate context");
  ok(!router.isActive('showPost', posts[2]), "The showPost handler is inactive when the context is different");
  ok(!router.isActive('adminPost'), "The adminPost handler is inactive");
  ok(!router.isActive('showPost', null), "The showPost handler is inactive with a null context");

  transitionTo('adminPost', admin, adminPost);
  ok(router.isActive('adminPost'), "The adminPost handler is active");
  ok(router.isActive('adminPost', adminPost), "The adminPost handler is active with the current context");
  ok(router.isActive('adminPost', admin, adminPost), "The adminPost handler is active with the current and parent context");
  ok(router.isActive('admin'), "The admin handler is active");
  ok(router.isActive('admin', admin), "The admin handler is active with its context");
});

test("calling generate on a non-dynamic route does not blow away parent contexts", function() {
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
  });
});

test("calling transitionTo on a dynamic parent route causes non-dynamic child context to be updated", function() {
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

  transitionTo('/project/1');
  deepEqual(projectHandler.context, { project_id: '1' }, 'project handler retains correct context');
  deepEqual(projectIndexHandler.context, { project_id: '1' }, 'project index handler has correct context');

  router.generate('projectIndex', { project_id: '2' });

  deepEqual(projectHandler.context, { project_id: '1' }, 'project handler retains correct context');
  deepEqual(projectIndexHandler.context, { project_id: '1' }, 'project index handler retains correct context');

  transitionTo('projectIndex', { project_id: '2' });
  deepEqual(projectHandler.context, { project_id: '2' }, 'project handler has updated context');
  deepEqual(projectIndexHandler.context, { project_id: '2' }, 'project index handler has updated context');
});

test("reset exits and clears the current and target route handlers", function() {
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

  transitionTo("/posts/all");

  router.reset();
  router.reset(); // two resets back to back should work

  ok(postIndexExited, "Post index handler did not exit");
  ok(showAllPostsExited, "Show all posts handler did not exit");
  equal(router.currentHandlerInfos, null, "currentHandlerInfos should be null");
  equal(router.targetHandlerInfos, null, "targetHandlerInfos should be null");
});

test("any of the model hooks can redirect with or without promise", function() {
  expect(26);
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
      afterModel: redirectToAbout,

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

  function testStartup(firstExpectedURL) {
    map(function(match) {
      match("/").to('index');
      match("/about").to('about');
      match("/foo").to('foo');
      match("/borf").to('borf');
    });

    redirectTo = 'about';

    // Perform a redirect on startup.
    expectedUrl = firstExpectedURL || '/about';
    transitionTo('/');

    expectedUrl = '/borf';
    redirectTo = 'borf';

    transitionTo('index');
  }

  testStartup();

  returnPromise = true;
  testStartup();

  delete handlers.index.beforeModel;
  returnPromise = false;
  testStartup();

  returnPromise = true;
  testStartup();

  delete handlers.index.model;
  returnPromise = false;
  testStartup();

  returnPromise = true;
  testStartup();

  delete handlers.index.afterModel;
  setupShouldBeEntered = true;
  shouldFinish = true;
  testStartup('/');
});


test("transitionTo with a promise pauses the transition until resolve, passes resolved context to setup", function() {
  handlers = {
    index: {},
    showPost: {
      setup: function(context) {
        deepEqual(context, { id: 1 }, "setup receives a resolved context");
      }
    }
  };

  transitionTo('/index');

  transitionTo('showPost', new RSVP.Promise(function(resolve, reject) {
    resolve({ id: 1 });
  }));
});

test("error handler gets called for errors in validation hooks", function() {
  expect(25);
  var setupShouldBeEntered = false;
  var expectedReason = { reason: 'No funciona, mon frere.' };

  function throwAnError() {
    return RSVP.reject(expectedReason);
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

      return router.transitionTo('index').then(shouldNotHappen, function(newReason) {
        equal(newReason, expectedReason, "transitionTo error reason is what was originally thrown");
      });
    });
  }

  testStartup().then(function(result) {
    return testStartup();
  }).then(function(result) {
    delete handlers.index.beforeModel;
    return testStartup();
  }).then(function(result) {
    return testStartup();
  }).then(function(result) {
    delete handlers.index.model;
    return testStartup();
  }).then(function(result) {
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

test("can redirect from error handler", function() {

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

              return router.transitionTo('showPost', RSVP.reject('borf!')).then(shouldNotHappen, function(e) {
                equal(e, 'borf!', "got thing");
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

function assertAbort(e) {
  ok(e instanceof Router.TransitionAborted, "transition was aborted");
}

test("can redirect from setup/enter", function() {
  expect(6);

  var count = 0;

  handlers = {
    index: {
      enter: function() {
        ok(true, "index#enter called");
        router.transitionTo('about').then(secondAttempt, shouldNotHappen);
      },
      setup: function() {
        ok(true, "index#setup called");
        router.transitionTo('/about').then(thirdAttempt, shouldNotHappen);
      },
      events: {
        error: function(e) {
          ok(false, "redirects should not call error hook");
        }
      }
    },
    about: {
      setup: function() {
        ok(true, "about#setup was entered");
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
    router.transitionTo('index').then(null, shouldNotHappen);
  }
});


test("redirecting to self from validation hooks should no-op (and not infinite loop)", function() {

  expect(2);

  var count = 0;

  handlers = {
    index: {
      afterModel: function() {
        if (count++ > 10) {
          ok(false, 'infinite loop occurring');
        } else {
          ok(count <= 2, 'running index no more than twice');
          router.transitionTo('index');
        }
      },
      setup: function() {
        ok(true, 'setup was called');
      }
    }
  };

  router.handleURL('/index');
});

test("Transition#method(null) prevents URLs from updating", function() {
  expect(1);

  handlers = {
    about: {
      setup: function() {
        ok(true, "about#setup was called");
      }
    }
  };

  router.updateURL = function(newUrl) {
    ok(false, "updateURL shouldn't have been called");
  };

  // Test multiple calls to method in a row.
  router.handleURL('/index').method(null);
  router.handleURL('/index').method(null);
  flushBackburner();

  router.transitionTo('about').method(null);
  flushBackburner();
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

test("redirecting to child handler from validation hooks should no-op (and not infinite loop)", function() {
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

test("transitionTo with named transition can be called at startup", function() {
  expect(2);

  startUpSetup();

  router.transitionTo('index').then(function() {
    ok(true, 'success handler called');
    start();
  }, function(e) {
    ok(false, 'failure handle should not be called');
  });
});

test("transitionTo with URL transition can be called at startup", function() {
  expect(2);

  startUpSetup();

  router.transitionTo('/index').then(function() {
    ok(true, 'success handler called');
    start();
  }, function(e) {
    ok(false, 'failure handle should not be called');
  });
});

test("transitions fire a didTransition event on the destination route", function() {

  expect(1);

  handlers = {
    about: {
      events: {
        didTransition: function() {
          ok(true, "index's didTransition was called");
        }
      }
    }
  };

  router.handleURL('/index').then(function() {
    router.transitionTo('about').then(start, shouldNotHappen);
  }, shouldNotHappen);
});

test("transitions can be aborted in the willTransition event", function() {

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
    return router.transitionTo('about').then(shouldNotHappen, function(e) {
      equal(e.name, 'TransitionAborted', 'reject object is a TransitionAborted');
    }).then(start);
  });
});

test("transitions can redirected in the willTransition event", function() {

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

test("aborted transitions can be saved and later retried", function() {

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
    }, shouldNotHappen);
  });
});

test("completed transitions can be saved and later retried", function() {
  expect(3);

  var post = { id: "123" },
      savedTransition;

  handlers = {
    showPost: {
      afterModel: function(model, transition) {
        equal(model, post, "showPost's afterModel got the expected post model");
        savedTransition = transition;
      }
    },
    index: { },
    about: {
      setup: function() {
        ok(true, "setup was entered");
      }
    }
  };

  router.handleURL('/index').then(function() {
    return router.transitionTo('showPost', post);
  }).then(function() {
    return router.transitionTo('about');
  }).then(function() {
    return savedTransition.retry();
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

test("authenticated routes: starting on non-auth route", function() {
  expect(8);

  setupAuthenticatedExample();

  transitionTo('/index');
  transitionToWithAbort('about');
  transitionToWithAbort('about');
  transitionToWithAbort('/admin/about');

  // Log in. This will retry the last failed transition to 'about'.
  router.trigger('logUserIn');
});

test("authenticated routes: starting on auth route", function() {
  expect(8);

  setupAuthenticatedExample();

  transitionToWithAbort('/admin/about');
  transitionToWithAbort('/admin/about');
  transitionToWithAbort('about');

  // Log in. This will retry the last failed transition to 'about'.
  router.trigger('logUserIn');
});

test("authenticated routes: starting on parameterized auth route", function() {
  expect(5);

  setupAuthenticatedExample();

  transitionToWithAbort('/admin/posts/5');

  // Log in. This will retry the last failed transition to '/posts/5'.
  router.trigger('logUserIn');
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

test("transitionTo will soak up resolved all models of active transition, including present route's resolved model", function() {

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

    redirect: function(resolvedModel, transition) {
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


test("resolved models can be swapped out within afterModel", function() {

  expect(3);

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

  router.transitionTo('index');
});


test("String/number args in transitionTo are treated as url params", function() {
  expect(10);

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

test("exceptions thrown from model hooks aren't swallowed", function() {

  expect(7);

  enableErrorHandlingDeferredActionQueue();

  var anError = {};
  function throwAnError() {
    throw anError;
  }

  var routeWasEntered = false;

  handlers = {
    index: {
      beforeModel: throwAnError,
      model: throwAnError,
      afterModel: throwAnError,
      setup: function(model) {
        routeWasEntered = true;
      }
    }
  };

  var hooks = ['beforeModel', 'model', 'afterModel'];

  while(hooks.length) {
    var transition = router.transitionTo('index');
    flush(anError);
    transition.abort();
    ok(!routeWasEntered, "route hasn't been entered yet");
    delete handlers.index[hooks.shift()];
  }

  router.transitionTo('index');
  flush(anError);

  ok(routeWasEntered, "route was finally entered");
});

module("Multiple dynamic segments per route", {
  setup: function() {

    RSVP.configure('async', customAsync);
    bb.begin();

  },

  teardown: function() {
    bb.end();
  }
});

test("Multiple string/number params are soaked up", function() {
  expect(3);

  map(function(match) {
    match("/:foo_id/:bar_id").to("bar");
  });

  handlers = {
    bar: {
      model: function(params) {
        return {};
      }
    },
  };

  expectedUrl = '/omg/lol';
  transitionTo('bar', 'omg', 'lol');

  expectedUrl = '/omg/heehee';
  transitionTo('bar', 'heehee');

  expectedUrl = '/lol/no';
  transitionTo('bar', 'lol', 'no');
});

module("isActive", {
  setup: function() {

    RSVP.configure('async', customAsync);
    bb.begin();

    handlers = {
      parent: {
        serialize: function(obj) {
          return {
            one: obj.one,
            two: obj.two,
          };
        }
      },
      child: {
        serialize: function(obj) {
          return {
            three: obj.three,
            four: obj.four,
          };
        }
      }
    };

    map(function(match) {
      match("/:one/:two").to("parent", function(match) {
        match("/:three/:four").to("child");
      });
    });

    expectedUrl = null;

    transitionTo('child', 'a', 'b', 'c', 'd');
  },
  teardown: function() {
    bb.end();
  }
});

test("isActive supports multiple soaked up string/number params (via params)", function() {

  ok(router.isActive('child'), "child");
  ok(router.isActive('parent'), "parent");

  ok(router.isActive('child', 'd'), "child d");
  ok(router.isActive('child', 'c', 'd'), "child c d");
  ok(router.isActive('child', 'b', 'c', 'd'), "child b c d");
  ok(router.isActive('child', 'a', 'b', 'c', 'd'), "child a b c d");

  ok(!router.isActive('child', 'e'), "!child e");
  ok(!router.isActive('child', 'c', 'e'), "!child c e");
  ok(!router.isActive('child', 'e', 'd'), "!child e d");
  ok(!router.isActive('child', 'x', 'x'), "!child x x");
  ok(!router.isActive('child', 'b', 'c', 'e'), "!child b c e");
  ok(!router.isActive('child', 'b', 'e', 'd'), "child b e d");
  ok(!router.isActive('child', 'e', 'c', 'd'), "child e c d");
  ok(!router.isActive('child', 'a', 'b', 'c', 'e'), "child a b c e");
  ok(!router.isActive('child', 'a', 'b', 'e', 'd'), "child a b e d");
  ok(!router.isActive('child', 'a', 'e', 'c', 'd'), "child a e c d");
  ok(!router.isActive('child', 'e', 'b', 'c', 'd'), "child e b c d");

  ok(router.isActive('parent', 'b'), "parent b");
  ok(router.isActive('parent', 'a', 'b'), "parent a b");

  ok(!router.isActive('parent', 'c'), "!parent c");
  ok(!router.isActive('parent', 'a', 'c'), "!parent a c");
  ok(!router.isActive('parent', 'c', 'b'), "!parent c b");
  ok(!router.isActive('parent', 'c', 't'), "!parent c t");
});

test("isActive supports multiple soaked up string/number params (via serialized objects)", function() {

  ok(router.isActive('child',  { three: 'c', four: 'd' }), "child(3:c, 4:d)");
  ok(!router.isActive('child', { three: 'e', four: 'd' }), "!child(3:e, 4:d)");
  ok(!router.isActive('child', { three: 'c', four: 'e' }), "!child(3:c, 4:e)");
  ok(!router.isActive('child', { three: 'c' }), "!child(3:c)");
  ok(!router.isActive('child', { four: 'd' }), "!child(4:d)");
  ok(!router.isActive('child', {}), "!child({})");

  ok(router.isActive('parent',  { one: 'a', two: 'b' }), "parent(1:a, 2:b)");
  ok(!router.isActive('parent', { one: 'e', two: 'b' }), "!parent(1:e, 2:b)");
  ok(!router.isActive('parent', { one: 'a', two: 'e' }), "!parent(1:a, 2:e)");
  ok(!router.isActive('parent', { one: 'a' }), "!parent(1:a)");
  ok(!router.isActive('parent', { two: 'b' }), "!parent(2:b)");

  ok(router.isActive('child', { one: 'a', two: 'b' }, { three: 'c', four: 'd' }), "child(1:a, 2:b, 3:c, 4:d)");
  ok(!router.isActive('child', { one: 'e', two: 'b' }, { three: 'c', four: 'd' }), "!child(1:e, 2:b, 3:c, 4:d)");
  ok(!router.isActive('child', { one: 'a', two: 'b' }, { three: 'c', four: 'e' }), "!child(1:a, 2:b, 3:c, 4:e)");
});

test("isActive supports multiple soaked up string/number params (mixed)", function() {
  ok(router.isActive('child', 'a', 'b', { three: 'c', four: 'd' }));
  ok(router.isActive('child', 'b', { three: 'c', four: 'd' }));
  ok(!router.isActive('child', 'a', { three: 'c', four: 'd' }));
  ok(router.isActive('child', { one: 'a', two: 'b' }, 'c', 'd'));
  ok(router.isActive('child', { one: 'a', two: 'b' }, 'd'));
  ok(!router.isActive('child', { one: 'a', two: 'b' }, 'c'));

  ok(!router.isActive('child', 'a', 'b', { three: 'e', four: 'd' }));
  ok(!router.isActive('child', 'b', { three: 'e', four: 'd' }));
  ok(!router.isActive('child', { one: 'e', two: 'b' }, 'c', 'd'));
  ok(!router.isActive('child', { one: 'e', two: 'b' }, 'd'));
});

module("Preservation of params between redirects", {
  setup: function() {

    RSVP.configure('async', customAsync);
    bb.begin();

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
  },

  teardown: function() {
    bb.end();
  }
});

test("Starting on '/' root index", function() {
  transitionTo('/');

  // Should call model for foo and bar
  expectedUrl = "/123/789";
  transitionTo('barIndex', '123', '456');

  equal(handlers.foo.modelCount, 2, "redirect in foo#afterModel should run foo#model twice (since validation failed)");

  deepEqual(handlers.foo.context, { id: '123' });
  deepEqual(handlers.bar.context, { id: '789' }, "bar should have redirected to bar 789");

  // Try setting foo's context to 200; this should redirect
  // bar to '789' but preserve the new foo 200.
  expectedUrl = "/200/789";
  transitionTo('fooIndex', '200');

  equal(handlers.foo.modelCount, 4, "redirect in foo#afterModel should re-run foo#model");

  deepEqual(handlers.foo.context, { id: '200' });
  deepEqual(handlers.bar.context, { id: '789' }, "bar should have redirected to bar 789");
});

test("Starting on '/' root index, using redirect", function() {

  handlers.foo.redirect = handlers.foo.afterModel;
  delete handlers.foo.afterModel;

  transitionTo('/');

  // Should call model for foo and bar
  expectedUrl = "/123/789";
  transitionTo('barIndex', '123', '456');

  equal(handlers.foo.modelCount, 1, "redirect in foo#redirect should NOT run foo#model (since validation succeeded)");

  deepEqual(handlers.foo.context, { id: '123' });
  deepEqual(handlers.bar.context, { id: '789' }, "bar should have redirected to bar 789");

  // Try setting foo's context to 200; this should redirect
  // bar to '789' but preserve the new foo 200.
  expectedUrl = "/200/789";
  transitionTo('fooIndex', '200');

  equal(handlers.foo.modelCount, 2, "redirect in foo#redirect should NOT foo#model");

  deepEqual(handlers.foo.context, { id: '200' });
  deepEqual(handlers.bar.context, { id: '789' }, "bar should have redirected to bar 789");
});

test("Starting on non root index", function() {
  transitionTo('/123/456');
  deepEqual(handlers.foo.context, { id: '123' });
  deepEqual(handlers.bar.context, { id: '789' }, "bar should have redirected to bar 789");

  // Try setting foo's context to 200; this should redirect
  // bar to '789' but preserve the new foo 200.
  expectedUrl = "/200/789";

  transitionTo('fooIndex', '200');

  deepEqual(handlers.foo.context, { id: '200' });
  deepEqual(handlers.bar.context, { id: '789' }, "bar should have redirected to bar 789");
});

test("A failed handler's setup shouldn't prevent future transitions", function() {
  expect(2);

  enableErrorHandlingDeferredActionQueue();

  map(function(match) {
    match("/parent").to('parent', function(match) {
      match("/articles").to('articles');
      match("/login").to('login');
    });
  });

  var error = new Error("blorg");

  handlers = {
    articles: {
      setup: function() {
        ok(true, "articles setup was entered");
        throw error;
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
  flush(error);
});

test("beforeModel shouldn't be refired with incorrect params during redirect", function() {
  // Source: https://github.com/emberjs/ember.js/issues/3407

  expect(3);

  map(function(match) {
    match("/").to('index');
    match("/people/:id").to('people', function(match) {
      match("/").to('peopleIndex');
      match("/home").to('peopleHome');
    });
  });

  var peopleModels = [null, {}, {}];
  var peopleBeforeModelCalled = false;

  handlers = {
    people: {
      beforeModel: function() {
        ok(!peopleBeforeModelCalled, "people#beforeModel should only be called once");
        peopleBeforeModelCalled = true;
      },
      model: function(params) {
        ok(params.id, "people#model called");
        return peopleModels[params.id];
      }
    },
    peopleIndex: {
      afterModel: function() {
        router.transitionTo('peopleHome');
      }
    },
    peopleHome: {
      setup: function() {
        ok(true, "I was entered");
      }
    }
  };

  transitionTo('/');
  transitionTo('peopleIndex', '1');
});

module("URL-less routes", {
  setup: function() {

    RSVP.configure('async', customAsync);
    bb.begin();

    handlers = {};
    expectedUrl = null;

    map(function(match) {
      match("/index").to("index");
      match("/admin").to("admin", function(match) {
        match("/posts").to("adminPosts");
        match("/articles").to("adminArticles");
      });
    });
  },

  teardown: function() {
    bb.end();
  }
});

test("Transitioning into a route marked as inaccessibleByURL doesn't update the URL", function() {
  expect(1);

  handlers = {
    adminPosts: {
      inaccessibleByURL: true
    }
  };

  router.handleURL('/index').then(function() {
    url = '/index';
    return router.transitionTo('adminPosts');
  }).then(function() {
    equal(url, '/index');
  });
});

test("Transitioning into a route with a parent route marked as inaccessibleByURL doesn't update the URL", function() {
  expect(2);

  handlers = {
    admin: {
      inaccessibleByURL: true
    }
  };

  transitionTo('/index');
  url = '/index';
  transitionTo('adminPosts');
  equal(url, '/index');
  transitionTo('adminArticles');
  equal(url, '/index');
});

test("Handling a URL on a route marked as inaccessible behave like a failed url match", function() {

  expect(1);

  handlers = {
    admin: {
      inaccessibleByURL: true
    }
  };

  router.handleURL('/index').then(function() {
    return router.handleURL('/admin/posts');
  }).then(shouldNotHappen, function(e) {
    ok(e instanceof Router.UnrecognizedURLError, "rejects with UnrecognizedURLError");
  }).then(start);
  flushBackburner();
});

module("Intermediate transitions", {
  setup: function() {

    RSVP.configure('async', customAsync);
    bb.begin();

    handlers = {};
    expectedUrl = null;

    map(function(match) {
      match("/").to("application", function(match) {
        //match("/").to("index");
        match("/foo").to("foo");
        match("/loading").to("loading");
      });
    });
  },

  teardown: function() {
    bb.end();
  }
});

test("intermediateTransitionTo() forces an immediate intermediate transition that doesn't cancel currently active async transitions", function() {

  expect(11);

  var counter = 1,
      willResolves,
      appModel = {},
      fooModel = {};

  function counterAt(expectedValue, description) {
    equal(counter, expectedValue, "Step " + expectedValue + ": " + description);
    counter++;
  }

  handlers = {
    application: {
      model: function() {
        return appModel;
      },
      setup: function(obj) {
        counterAt(1, "application#setup");
        equal(obj, appModel, "application#setup is passed the return value from model");
      },
      events: {
        willResolveModel: function(transition, handler) {
          equal(willResolves.shift(), handler, "willResolveModel event fired and passed expanded handler");
        }
      }
    },
    foo: {
      model: function() {
        router.intermediateTransitionTo('loading');
        counterAt(3, "intermediate transition finished within foo#model");

        return new RSVP.Promise(function(resolve) {
          counterAt(4, "foo's model promise resolves");
          resolve(fooModel);
        });
      },
      setup: function(obj) {
        counterAt(6, "foo#setup");
        equal(obj, fooModel, "foo#setup is passed the resolve model promise");
      }
    },
    loading: {
      model: function() {
        ok(false, "intermediate transitions don't call model hooks");
      },
      setup: function() {
        counterAt(2, "loading#setup");
      },
      exit: function() {
        counterAt(5, "loading state exited");
      }
    }
  };

  willResolves = [handlers.application, handlers.foo];

  transitionTo('/foo');

  counterAt(7, "original transition promise resolves");
});

