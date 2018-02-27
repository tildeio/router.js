import {
  module,
  test,
  flushBackburner,
  handleURL,
  transitionTo,
  transitionToWithAbort,
  replaceWith,
  shouldNotHappen,
  assertAbort,
} from './test_helpers';
import Router from 'router';
import { reject, Promise } from 'rsvp';

var router, url, handlers, serializers, expectedUrl;

var scenarios = [
  {
    name: 'Sync Get Handler',
    async: false,
    getHandler: function(name) {
      return handlers[name] || (handlers[name] = {});
    },
    getSerializer: function() {},
  },
  {
    name: 'Async Get Handler',
    async: true,
    getHandler: function(name) {
      // Treat 'loading' route transitions are synchronous
      var handler = handlers[name] || (handlers[name] = {});
      return name === 'loading' ? handler : Promise.resolve(handler);
    },
    getSerializer: function(name) {
      return serializers && serializers[name];
    },
  },
];

scenarios.forEach(function(scenario) {
  module('The router (' + scenario.name + ')', {
    setup: function(assert) {
      handlers = {};
      expectedUrl = null;

      map(assert, function(match) {
        match('/index').to('index');
        match('/about').to('about');
        match('/faq').to('faq');
        match('/nested').to('nestedParent', function(match) {
          match('/').to('nestedChild');
        });
        match('/posts', function(match) {
          match('/:id').to('showPost');
          match('/:postId/:commentId').to('showComment');
          match('/on/:date').to('showPostsForDate');
          match('/admin/:id').to('admin', function(match) {
            match('/posts').to('adminPosts');
            match('/posts/:post_id').to('adminPost');
          });
          match('/').to('postIndex', function(match) {
            match('/all').to('showAllPosts');

            // TODO: Support canonical: true
            match('/').to('showAllPosts');
            match('/popular').to('showPopularPosts');
            match('/filter/:filter_id').to('showFilteredPosts');
          });
        });
      });
    },
  });

  function map(assert, fn) {
    router = new Router({
      getHandler: scenario.getHandler,

      getSerializer: scenario.getSerializer,

      updateURL: function(newUrl) {
        if (expectedUrl) {
          assert.equal(
            newUrl,
            expectedUrl,
            'The url is ' + newUrl + ' as expected'
          );
        }

        url = newUrl;
      },
    });

    router.map(fn);
  }

  test('Mapping adds named routes to the end', function(assert) {
    url = router.recognizer.generate('showPost', { id: 1 });
    assert.equal(url, '/posts/1');

    url = router.recognizer.generate('showAllPosts');
    assert.equal(url, '/posts');

    url = router.recognizer.generate('showComment', {
      postId: 1,
      commentId: 2,
    });
    assert.equal(url, '/posts/1/2');

    url = router.generate('showComment', 1, 2);
    assert.equal(url, '/posts/1/2');
  });

  test('Handling an invalid URL returns a rejecting promise', function(assert) {
    router.handleURL('/unknown').then(
      shouldNotHappen(assert),
      function(e) {
        assert.equal(
          e.name,
          'UnrecognizedURLError',
          'error.name is UnrecognizedURLError'
        );
      },
      shouldNotHappen(assert)
    );
  });

  function routePath(infos) {
    var path = [];

    for (var i = 0, l = infos.length; i < l; i++) {
      path.push(infos[i].name);
    }

    return path.join('.');
  }

  test('Handling a URL triggers model on the handler and passes the result into the setup method', function(assert) {
    assert.expect(4);

    var post = { post: true };

    handlers = {
      showPost: {
        model: function(params) {
          assert.deepEqual(
            params,
            { id: '1', queryParams: {} },
            'showPost#model called with id 1'
          );
          return post;
        },

        setup: function(object) {
          assert.strictEqual(
            object,
            post,
            'setup was called with expected model'
          );
          assert.equal(
            handlers.showPost.context,
            post,
            'context was properly set on showPost handler'
          );
        },
      },
    };

    router.didTransition = function(infos) {
      assert.equal(routePath(infos), 'showPost');
    };

    router.handleURL('/posts/1');
  });

  test('isActive should not break on initial intermediate route', function(assert) {
    assert.expect(1);
    router.intermediateTransitionTo('/posts/admin/1/posts');
    assert.ok(router.isActive('admin', '1'));
  });

  test('Handling a URL passes in query params', function(assert) {
    assert.expect(3);

    handlers = {
      index: {
        model: function(params, transition) {
          assert.deepEqual(transition.queryParams, {
            sort: 'date',
            filter: 'true',
          });
        },
        events: {
          finalizeQueryParamChange: function(params, finalParams) {
            assert.ok(true, 'finalizeQueryParamChange');
            // need to consume the params so that the router
            // knows that they're active
            finalParams.push({ key: 'sort', value: params.sort });
            finalParams.push({ key: 'filter', value: params.filter });
          },
        },
      },
    };

    router.handleURL('/index?sort=date&filter');
    flushBackburner();
    assert.deepEqual(router.state.queryParams, {
      sort: 'date',
      filter: 'true',
    });
  });

  test('handleURL accepts slash-less URLs', function(assert) {
    assert.expect(1);

    handlers = {
      showAllPosts: {
        setup: function() {
          assert.ok(true, "showAllPosts' setup called");
        },
      },
    };

    router.handleURL('posts/all');
  });

  test('handleURL accepts query params', function(assert) {
    assert.expect(1);

    handlers = {
      showAllPosts: {
        setup: function() {
          assert.ok(true, "showAllPosts' setup called");
        },
      },
    };

    router.handleURL('/posts/all?sort=name&sortDirection=descending');
  });

  test("redirect hook shouldn't get called on parent routes", function(assert) {
    map(assert, function(match) {
      match('/').to('app', function(match) {
        match('/').to('index');
        match('/other').to('other');
      });
    });

    var appRedirects = 0;
    handlers = {
      app: {
        redirect: function() {
          appRedirects++;
        },
      },
    };

    transitionTo(router, '/');
    assert.equal(appRedirects, 1);
    transitionTo(router, 'other');
    assert.equal(appRedirects, 1);
  });

  test('when transitioning with the same context, setup should only be called once', function(assert) {
    var parentSetupCount = 0,
      childSetupCount = 0;

    var context = { id: 1 };

    map(assert, function(match) {
      match('/').to('index');
      match('/posts/:id').to('post', function(match) {
        match('/details').to('postDetails');
      });
    });

    handlers = {
      post: {
        setup: function() {
          parentSetupCount++;
        },
      },

      postDetails: {
        setup: function() {
          childSetupCount++;
        },
      },
    };

    transitionTo(router, '/');

    assert.equal(parentSetupCount, 0, 'precondition - parent not setup');
    assert.equal(childSetupCount, 0, 'precondition - child not setup');

    transitionTo(router, 'postDetails', context);

    assert.equal(
      parentSetupCount,
      1,
      'after initial transition parent is setup once'
    );
    assert.equal(
      childSetupCount,
      1,
      'after initial transition child is setup once'
    );

    transitionTo(router, 'postDetails', context);

    assert.equal(
      parentSetupCount,
      1,
      'after duplicate transition, parent is still setup once'
    );
    assert.equal(
      childSetupCount,
      1,
      'after duplicate transition, child is still setup once'
    );
  });

  test("when transitioning to a new parent and child state, the parent's context should be available to the child's model", function(assert) {
    assert.expect(1);
    var contexts = [];

    map(assert, function(match) {
      match('/').to('index');
      match('/posts/:id').to('post', function(match) {
        match('/details').to('postDetails');
      });
    });

    handlers = {
      post: {
        model: function() {
          return contexts.post;
        },
      },

      postDetails: {
        name: 'postDetails',
        afterModel: function(model, transition) {
          contexts.push(transition.resolvedModels.post);
        },
      },
    };

    router
      .handleURL('/')
      .then(function() {
        // This is a crucial part of the test
        // In some cases, calling `generate` was preventing `model` from being called
        router.generate('postDetails', { id: 1 });

        return router.transitionTo('postDetails', { id: 1 });
      }, shouldNotHappen(assert))
      .then(function() {
        assert.deepEqual(contexts, [{ id: 1 }], 'parent context is available');
      }, shouldNotHappen(assert));
  });

  test('A delegate provided to router.js is passed along to route-recognizer', function(assert) {
    router = new Router({
      delegate: {
        willAddRoute: function(context, route) {
          if (!context) {
            return route;
          }

          if (context === 'application') {
            return route;
          }

          return context + '.' + route;
        },

        // Test that both delegates work together
        contextEntered: function(name, match) {
          match('/').to('index');
        },
      },
    });

    router.map(function(match) {
      match('/').to('application', function(match) {
        match('/posts').to('posts', function(match) {
          match('/:post_id').to('post');
        });
      });
    });

    var handlers = [];

    router.getHandler = function(handler) {
      handlers.push(handler);
      return scenario.async ? Promise.resolve({}) : {};
    };

    router.handleURL('/posts').then(function() {
      assert.deepEqual(handlers, ['application', 'posts', 'posts.index']);
    });
  });

  test('handleURL: Handling a nested URL triggers each handler', function(assert) {
    assert.expect(28);

    var posts = [];
    var allPosts = { all: true };
    var popularPosts = { popular: true };
    var amazingPosts = { id: 'amazing' };
    var sadPosts = { id: 'sad' };

    var counter = 0;

    var postIndexHandler = {
      model: function(params) {
        // this will always get called, since it's at the root
        // of all of the routes tested here
        assert.deepEqual(
          params,
          { queryParams: {} },
          'params should be empty in postIndexHandler#model'
        );
        return posts;
      },

      setup: function(object) {
        if (counter === 0) {
          assert.equal(
            postIndexHandler.context,
            posts,
            'postIndexHandler context should be set up in postIndexHandler#setup'
          );
          assert.strictEqual(
            object,
            posts,
            'The object passed in to postIndexHandler#setup should be posts'
          );
        } else {
          assert.ok(false, 'Should not get here');
        }
      },
    };

    var showAllPostsHandler = {
      model: function(params) {
        if (counter > 0 && counter < 4) {
          assert.equal(
            postIndexHandler.context,
            posts,
            'postIndexHandler context should be set up in showAllPostsHandler#model'
          );
        }

        if (counter < 4) {
          assert.deepEqual(
            params,
            { queryParams: {} },
            'params should be empty in showAllPostsHandler#model'
          );
          return allPosts;
        } else {
          assert.ok(false, 'Should not get here');
        }
      },

      setup: function(object) {
        if (counter === 0) {
          assert.equal(
            postIndexHandler.context,
            posts,
            'postIndexHandler context should be set up in showAllPostsHandler#setup'
          );
          assert.equal(
            showAllPostsHandler.context,
            allPosts,
            'showAllPostsHandler context should be set up in showAllPostsHandler#setup'
          );
          assert.strictEqual(
            object,
            allPosts,
            'The object passed in should be allPosts in showAllPostsHandler#setup'
          );
        } else {
          assert.ok(false, 'Should not get here');
        }
      },
    };

    var showPopularPostsHandler = {
      model: function(params) {
        if (counter < 3) {
          assert.ok(false, 'Should not get here');
        } else if (counter === 3) {
          assert.equal(
            postIndexHandler.context,
            posts,
            'postIndexHandler context should be set up in showPopularPostsHandler#model'
          );
          assert.deepEqual(
            params,
            { queryParams: {} },
            'params should be empty in showPopularPostsHandler#serialize'
          );
          return popularPosts;
        } else {
          assert.ok(false, 'Should not get here');
        }
      },

      setup: function(object) {
        if (counter === 3) {
          assert.equal(
            postIndexHandler.context,
            posts,
            'postIndexHandler context should be set up in showPopularPostsHandler#setup'
          );
          assert.equal(
            showPopularPostsHandler.context,
            popularPosts,
            'showPopularPostsHandler context should be set up in showPopularPostsHandler#setup'
          );
          assert.strictEqual(
            object,
            popularPosts,
            'The object passed to showPopularPostsHandler#setup should be popular posts'
          );
        } else {
          assert.ok(false, 'Should not get here');
        }
      },
    };

    var showFilteredPostsHandler = {
      model: function(params) {
        if (counter < 4) {
          assert.ok(false, 'Should not get here');
        } else if (counter === 4) {
          assert.equal(
            postIndexHandler.context,
            posts,
            'postIndexHandler context should be set up in showFilteredPostsHandler#model'
          );
          assert.deepEqual(
            params,
            { filter_id: 'amazing', queryParams: {} },
            "params should be { filter_id: 'amazing' } in showFilteredPostsHandler#model"
          );
          return amazingPosts;
        } else if (counter === 5) {
          assert.equal(
            postIndexHandler.context,
            posts,
            'postIndexHandler context should be posts in showFilteredPostsHandler#model'
          );
          assert.deepEqual(
            params,
            { filter_id: 'sad', queryParams: {} },
            "params should be { filter_id: 'sad' } in showFilteredPostsHandler#model"
          );
          return sadPosts;
        } else {
          assert.ok(false, 'Should not get here');
        }
      },

      setup: function(object) {
        if (counter === 4) {
          assert.equal(postIndexHandler.context, posts);
          assert.equal(showFilteredPostsHandler.context, amazingPosts);
          assert.strictEqual(object, amazingPosts);
        } else if (counter === 5) {
          assert.equal(postIndexHandler.context, posts);
          assert.equal(showFilteredPostsHandler.context, sadPosts);
          assert.strictEqual(object, sadPosts);
        } else {
          assert.ok(false, 'Should not get here');
        }
      },
    };

    handlers = {
      postIndex: postIndexHandler,
      showAllPosts: showAllPostsHandler,
      showPopularPosts: showPopularPostsHandler,
      showFilteredPosts: showFilteredPostsHandler,
    };

    router
      .transitionTo('/posts')
      .then(function() {
        assert.ok(true, '1: Finished, trying /posts/all');
        counter++;
        return router.transitionTo('/posts/all');
      }, shouldNotHappen(assert))
      .then(function() {
        assert.ok(true, '2: Finished, trying /posts');
        counter++;
        return router.transitionTo('/posts');
      }, shouldNotHappen(assert))
      .then(function() {
        assert.ok(true, '3: Finished, trying /posts/popular');
        counter++;
        return router.transitionTo('/posts/popular');
      }, shouldNotHappen(assert))
      .then(function() {
        assert.ok(true, '4: Finished, trying /posts/filter/amazing');
        counter++;
        return router.transitionTo('/posts/filter/amazing');
      }, shouldNotHappen(assert))
      .then(function() {
        assert.ok(true, '5: Finished, trying /posts/filter/sad');
        counter++;
        return router.transitionTo('/posts/filter/sad');
      }, shouldNotHappen(assert))
      .then(function() {
        assert.ok(true, '6: Finished!');
      }, shouldNotHappen(assert));
  });

  test('it can handle direct transitions to named routes', function(assert) {
    var allPosts = { all: true };
    var popularPosts = { popular: true };
    var amazingPosts = { filter: 'amazing' };
    var sadPosts = { filter: 'sad' };

    var postIndexHandler = {
      model: function() {
        return allPosts;
      },

      serialize: function() {
        return {};
      },
    };

    var showAllPostsHandler = {
      model: function() {
        //assert.ok(!params, 'params is falsy for non dynamic routes');
        return allPosts;
      },

      serialize: function() {
        return {};
      },

      setup: function(object) {
        assert.strictEqual(
          object,
          allPosts,
          'showAllPosts should get correct setup'
        );
      },
    };

    var showPopularPostsHandler = {
      model: function() {
        return popularPosts;
      },

      serialize: function() {
        return {};
      },

      setup: function(object) {
        assert.strictEqual(
          object,
          popularPosts,
          'showPopularPosts#setup should be called with the deserialized value'
        );
      },
    };

    var showFilteredPostsHandler = {
      model: function(params) {
        if (!params) {
          return;
        }
        if (params.filter_id === 'amazing') {
          return amazingPosts;
        } else if (params.filter_id === 'sad') {
          return sadPosts;
        }
      },

      serialize: function(object, params) {
        assert.deepEqual(
          params,
          ['filter_id'],
          'showFilteredPosts should get correct serialize'
        );
        return { filter_id: object.filter };
      },

      setup: function(object) {
        if (counter === 2) {
          assert.strictEqual(
            object,
            amazingPosts,
            'showFilteredPosts should get setup with amazingPosts'
          );
        } else if (counter === 3) {
          assert.strictEqual(
            object,
            sadPosts,
            'showFilteredPosts should get setup setup with sadPosts'
          );
        }
      },
    };

    handlers = {
      postIndex: postIndexHandler,
      showAllPosts: showAllPostsHandler,
      showPopularPosts: showPopularPostsHandler,
      showFilteredPosts: showFilteredPostsHandler,
    };

    router.updateURL = function(url) {
      var expected = {
        0: '/posts',
        1: '/posts/popular',
        2: '/posts/filter/amazing',
        3: '/posts/filter/sad',
        4: '/posts',
      };

      assert.equal(
        url,
        expected[counter],
        'updateURL should be called with correct url'
      );
    };

    var counter = 0;

    router
      .handleURL('/posts')
      .then(function() {
        return router.transitionTo('showAllPosts');
      }, shouldNotHappen(assert))
      .then(function() {
        counter++;
        return router.transitionTo('showPopularPosts');
      }, shouldNotHappen(assert))
      .then(function() {
        counter++;
        return router.transitionTo('showFilteredPosts', amazingPosts);
      }, shouldNotHappen(assert))
      .then(function() {
        counter++;
        return router.transitionTo('showFilteredPosts', sadPosts);
      }, shouldNotHappen(assert))
      .then(function() {
        counter++;
        return router.transitionTo('showAllPosts');
      }, shouldNotHappen(assert));
  });

  test('replaceWith calls replaceURL', function(assert) {
    var updateCount = 0,
      replaceCount = 0;

    router.updateURL = function() {
      updateCount++;
    };

    router.replaceURL = function() {
      replaceCount++;
    };

    router
      .handleURL('/posts')
      .then(function() {
        return router.replaceWith('about');
      })
      .then(function() {
        assert.equal(updateCount, 0, 'should not call updateURL');
        assert.equal(replaceCount, 1, 'should call replaceURL once');
      });
  });

  test('applyIntent returns a tentative state based on a named transition', function(assert) {
    transitionTo(router, '/posts');
    var state = router.applyIntent('faq', []);
    assert.ok(state.handlerInfos.length);
  });

  test('Moving to a new top-level route triggers exit callbacks', function(assert) {
    assert.expect(6);

    var allPosts = { posts: 'all' };
    var postsStore = { 1: { id: 1 }, 2: { id: 2 } };
    var currentId, currentPath;

    handlers = {
      showAllPosts: {
        model: function() {
          return allPosts;
        },

        setup: function(posts, transition) {
          assert.ok(!transition.isExiting(this));
          assert.equal(
            posts,
            allPosts,
            'The correct context was passed into showAllPostsHandler#setup'
          );
          currentPath = 'postIndex.showAllPosts';
        },

        exit: function(transition) {
          assert.ok(transition.isExiting(this));
        },
      },

      showPost: {
        model: function(params) {
          return postsStore[params.id];
        },

        serialize: function(post) {
          return { id: post.id };
        },

        setup: function(post) {
          currentPath = 'showPost';
          assert.equal(post.id, currentId, 'The post id is ' + currentId);
        },
      },
    };

    router
      .handleURL('/posts')
      .then(function() {
        expectedUrl = '/posts/1';
        currentId = 1;
        return router.transitionTo('showPost', postsStore[1]);
      }, shouldNotHappen(assert))
      .then(function() {
        assert.equal(routePath(router.currentHandlerInfos), currentPath);
      }, shouldNotHappen(assert));
  });

  test('pivotHandler is exposed on Transition object', function(assert) {
    assert.expect(3);

    handlers = {
      showAllPosts: {
        beforeModel: function(transition) {
          assert.ok(
            !transition.pivotHandler,
            'First route transition has no pivot route'
          );
        },
      },

      showPopularPosts: {
        beforeModel: function(transition) {
          assert.equal(
            transition.pivotHandler,
            handlers.postIndex,
            'showAllPosts -> showPopularPosts pivotHandler is postIndex'
          );
        },
      },

      postIndex: {},

      about: {
        beforeModel: function(transition) {
          assert.ok(
            !transition.pivotHandler,
            'top-level transition has no pivotHandler'
          );
        },
      },
    };

    router
      .handleURL('/posts')
      .then(function() {
        return router.transitionTo('showPopularPosts');
      })
      .then(function() {
        return router.transitionTo('about');
      });
  });

  test('transition.resolvedModels after redirects b/w routes', function(assert) {
    assert.expect(3);

    map(assert, function(match) {
      match('/').to('application', function(match) {
        match('/peter').to('peter');
        match('/wagenet').to('wagenet');
      });
    });

    var app = { app: true };

    handlers = {
      application: {
        model: function() {
          assert.ok(true, 'application#model');
          return app;
        },
      },

      peter: {
        model: function(params, transition) {
          assert.deepEqual(
            transition.resolvedModels.application,
            app,
            'peter: resolvedModel correctly stored in resolvedModels for parent route'
          );
          router.transitionTo('wagenet');
        },
      },
      wagenet: {
        model: function(params, transition) {
          assert.deepEqual(
            transition.resolvedModels.application,
            app,
            'wagenet: resolvedModel correctly stored in resolvedModels for parent route'
          );
        },
      },
    };

    transitionTo(router, '/peter');
  });

  test('transition.resolvedModels after redirects within the same route', function(assert) {
    var admin = { admin: true },
      redirect = true;

    handlers = {
      admin: {
        model: function() {
          assert.ok(true, 'admin#model');
          return admin;
        },
      },

      adminPosts: {
        model: function(params, transition) {
          assert.deepEqual(
            transition.resolvedModels.admin,
            admin,
            'resolvedModel correctly stored in resolvedModels for parent route'
          );
          if (redirect) {
            redirect = false;
            router.transitionTo('adminPosts');
          }
        },
      },
    };

    transitionTo(router, '/posts/admin/1/posts');
  });

  test('Moving to the same route with a different parent dynamic segment re-runs model', function(assert) {
    var admins = { 1: { id: 1 }, 2: { id: 2 } },
      adminPosts = { 1: { id: 1 }, 2: { id: 2 } };

    handlers = {
      admin: {
        model: function(params) {
          return (this.currentModel = admins[params.id]);
        },
      },

      adminPosts: {
        model: function() {
          return adminPosts[handlers.admin.currentModel.id];
        },
      },
    };

    transitionTo(router, '/posts/admin/1/posts');
    assert.equal(handlers.admin.context, admins[1]);
    assert.equal(handlers.adminPosts.context, adminPosts[1]);

    transitionTo(router, '/posts/admin/2/posts');
    assert.equal(handlers.admin.context, admins[2]);
    assert.equal(handlers.adminPosts.context, adminPosts[2]);
  });

  test('Moving to a sibling route only triggers exit callbacks on the current route (when transitioned internally)', function(assert) {
    assert.expect(8);

    var allPosts = { posts: 'all' };

    var showAllPostsHandler = {
      model: function() {
        return allPosts;
      },

      setup: function(posts) {
        assert.equal(
          posts,
          allPosts,
          'The correct context was passed into showAllPostsHandler#setup'
        );
      },

      enter: function() {
        assert.ok(true, 'The sibling handler should be entered');
      },

      exit: function() {
        assert.ok(true, 'The sibling handler should be exited');
      },
    };

    var filters = {};

    var showFilteredPostsHandler = {
      enter: function() {
        assert.ok(true, 'The new handler was entered');
      },

      exit: function() {
        assert.ok(false, 'The new handler should not be exited');
      },

      model: function(params) {
        var id = params.filter_id;
        if (!filters[id]) {
          filters[id] = { id: id };
        }

        return filters[id];
      },

      serialize: function(filter) {
        assert.equal(filter.id, 'favorite', "The filter should be 'favorite'");
        return { filter_id: filter.id };
      },

      setup: function(filter) {
        assert.equal(
          filter.id,
          'favorite',
          'showFilteredPostsHandler#setup was called with the favorite filter'
        );
      },
    };

    var postIndexHandler = {
      enter: function() {
        assert.ok(true, 'The outer handler was entered only once');
      },

      exit: function() {
        assert.ok(false, 'The outer handler was not exited');
      },
    };

    handlers = {
      postIndex: postIndexHandler,
      showAllPosts: showAllPostsHandler,
      showFilteredPosts: showFilteredPostsHandler,
    };

    router.handleURL('/posts').then(function() {
      expectedUrl = '/posts/filter/favorite';
      return router.transitionTo('showFilteredPosts', { id: 'favorite' });
    });
  });

  test('Moving to a sibling route only triggers exit callbacks on the current route (when transitioned via a URL change)', function(assert) {
    assert.expect(7);

    var allPosts = { posts: 'all' };

    var showAllPostsHandler = {
      model: function() {
        return allPosts;
      },

      setup: function(posts) {
        assert.equal(
          posts,
          allPosts,
          'The correct context was passed into showAllPostsHandler#setup'
        );
      },

      enter: function() {
        assert.ok(true, 'The sibling handler should be entered');
      },

      exit: function() {
        assert.ok(true, 'The sibling handler should be exited');
      },
    };

    var filters = {};

    var showFilteredPostsHandler = {
      enter: function() {
        assert.ok(true, 'The new handler was entered');
      },

      exit: function() {
        assert.ok(false, 'The new handler should not be exited');
      },

      model: function(params) {
        assert.equal(
          params.filter_id,
          'favorite',
          "The filter should be 'favorite'"
        );

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
        assert.equal(
          filter.id,
          'favorite',
          'showFilteredPostsHandler#setup was called with the favorite filter'
        );
      },
    };

    var postIndexHandler = {
      enter: function() {
        assert.ok(true, 'The outer handler was entered only once');
      },

      exit: function() {
        assert.ok(false, 'The outer handler was not exited');
      },
    };

    handlers = {
      postIndex: postIndexHandler,
      showAllPosts: showAllPostsHandler,
      showFilteredPosts: showFilteredPostsHandler,
    };

    router.handleURL('/posts');

    flushBackburner();

    expectedUrl = '/posts/filter/favorite';
    router.handleURL(expectedUrl);
  });

  test('events can be targeted at the current handler', function(assert) {
    assert.expect(2);

    handlers = {
      showPost: {
        enter: function() {
          assert.ok(true, 'The show post handler was entered');
        },

        events: {
          expand: function() {
            assert.equal(
              this,
              handlers.showPost,
              'The handler is the `this` for the event'
            );
          },
        },
      },
    };

    transitionTo(router, '/posts/1');

    router.trigger('expand');
  });

  test('event triggering is pluggable', function(assert) {
    handlers = {
      showPost: {
        enter: function() {
          assert.ok(true, 'The show post handler was entered');
        },

        actions: {
          expand: function() {
            assert.equal(
              this,
              handlers.showPost,
              'The handler is the `this` for the event'
            );
          },
        },
      },
    };
    router.triggerEvent = function(handlerInfos, ignoreFailure, args) {
      var name = args.shift();

      if (!handlerInfos) {
        if (ignoreFailure) {
          return;
        }
        throw new Error(
          "Could not trigger event '" + name + "'. There are no active handlers"
        );
      }

      for (var i = handlerInfos.length - 1; i >= 0; i--) {
        var handlerInfo = handlerInfos[i],
          handler = handlerInfo.handler;

        if (handler.actions && handler.actions[name]) {
          if (handler.actions[name].apply(handler, args) !== true) {
            return;
          }
        }
      }
    };
    router.handleURL('/posts/1').then(function() {
      router.trigger('expand');
    });
  });

  test('Unhandled events raise an exception', function(assert) {
    router.handleURL('/posts/1');

    assert.throws(function() {
      router.trigger('doesnotexist');
    }, /doesnotexist/);
  });

  test('events can be targeted at a parent handler', function(assert) {
    assert.expect(3);

    handlers = {
      postIndex: {
        enter: function() {
          assert.ok(true, 'The post index handler was entered');
        },

        events: {
          expand: function() {
            assert.equal(
              this,
              handlers.postIndex,
              'The handler is the `this` in events'
            );
          },
        },
      },
      showAllPosts: {
        enter: function() {
          assert.ok(true, 'The show all posts handler was entered');
        },
      },
    };

    transitionTo(router, '/posts');
    router.trigger('expand');
  });

  test('events can bubble up to a parent handler via `return true`', function(assert) {
    assert.expect(4);

    handlers = {
      postIndex: {
        enter: function() {
          assert.ok(true, 'The post index handler was entered');
        },

        events: {
          expand: function() {
            assert.equal(
              this,
              handlers.postIndex,
              'The handler is the `this` in events'
            );
          },
        },
      },
      showAllPosts: {
        enter: function() {
          assert.ok(true, 'The show all posts handler was entered');
        },
        events: {
          expand: function() {
            assert.equal(
              this,
              handlers.showAllPosts,
              'The handler is the `this` in events'
            );
            return true;
          },
        },
      },
    };

    router.handleURL('/posts').then(function() {
      router.trigger('expand');
    });
  });

  test("handled-then-bubbled events don't throw an exception if uncaught by parent route", function(assert) {
    assert.expect(3);

    handlers = {
      postIndex: {
        enter: function() {
          assert.ok(true, 'The post index handler was entered');
        },
      },

      showAllPosts: {
        enter: function() {
          assert.ok(true, 'The show all posts handler was entered');
        },
        events: {
          expand: function() {
            assert.equal(
              this,
              handlers.showAllPosts,
              'The handler is the `this` in events'
            );
            return true;
          },
        },
      },
    };

    transitionTo(router, '/posts');
    router.trigger('expand');
  });

  test('events only fire on the closest handler', function(assert) {
    assert.expect(5);

    handlers = {
      postIndex: {
        enter: function() {
          assert.ok(true, 'The post index handler was entered');
        },

        events: {
          expand: function() {
            assert.ok(false, 'Should not get to the parent handler');
          },
        },
      },

      showAllPosts: {
        enter: function() {
          assert.ok(true, 'The show all posts handler was entered');
        },

        events: {
          expand: function(passedContext1, passedContext2) {
            assert.equal(context1, passedContext1, 'A context is passed along');
            assert.equal(
              context2,
              passedContext2,
              'A second context is passed along'
            );
            assert.equal(
              this,
              handlers.showAllPosts,
              'The handler is passed into events as `this`'
            );
          },
        },
      },
    };

    var context1 = {},
      context2 = {};
    router.handleURL('/posts').then(function() {
      router.trigger('expand', context1, context2);
    });
  });

  test("Date params aren't treated as string/number params", function(assert) {
    assert.expect(1);

    handlers = {
      showPostsForDate: {
        serialize: function(date) {
          return {
            date:
              date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate(),
          };
        },

        model: function() {
          assert.ok(
            false,
            "model shouldn't be called; the date is the provided model"
          );
        },
      },
    };

    if (scenario.async) {
      serializers = {
        showPostsForDate: function(date) {
          return {
            date:
              date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate(),
          };
        },
      };
    }

    var result = router.generate('showPostsForDate', new Date(1815, 5, 18));
    assert.equal(result, '/posts/on/1815-5-18');
  });

  test('getSerializer takes precedence over handler.serialize', function(assert) {
    assert.expect(2);

    router.getSerializer = function() {
      return function(date) {
        assert.ok(true, 'getSerializer called');
        return {
          date:
            date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate(),
        };
      };
    };

    handlers = {
      showPostsForDate: {
        serialize: function() {
          assert.ok(false, "serialize method shouldn't be called");
          return {};
        },

        model: function() {
          assert.ok(
            false,
            "model shouldn't be called; the date is the provided model"
          );
        },
      },
    };

    assert.equal(
      router.generate('showPostsForDate', new Date(1815, 5, 18)),
      '/posts/on/1815-5-18'
    );
  });

  test('the serializer method is unbound', function(assert) {
    assert.expect(1);

    router.getSerializer = function() {
      return function(date) {
        assert.equal(this, undefined);
        return {
          date:
            date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate(),
        };
      };
    };

    router.generate('showPostsForDate', new Date(1815, 5, 18));
  });

  test('params are known by a transition up front', function(assert) {
    assert.expect(2);

    handlers = {
      postIndex: {
        model: function(params, transition) {
          assert.deepEqual(transition.params, {
            postIndex: {},
            showFilteredPosts: { filter_id: 'sad' },
          });
        },
      },
      showFilteredPosts: {
        model: function(params, transition) {
          assert.deepEqual(transition.params, {
            postIndex: {},
            showFilteredPosts: { filter_id: 'sad' },
          });
        },
      },
    };

    transitionTo(router, '/posts/filter/sad', 'blorg');
  });

  test('transitionTo uses the current context if you are already in a handler with a context that is not changing', function(assert) {
    var admin = { id: 47 },
      adminPost = { id: 74 };

    handlers = {
      admin: {
        serialize: function(object) {
          assert.equal(
            object.id,
            47,
            'The object passed to serialize is correct'
          );
          return { id: 47 };
        },

        model: function(params) {
          assert.equal(
            params.id,
            47,
            'The object passed to serialize is correct'
          );
          return admin;
        },
      },

      adminPost: {
        serialize: function(object) {
          return { post_id: object.id };
        },

        model: function(params) {
          assert.equal(
            params.id,
            74,
            'The object passed to serialize is correct'
          );
          return adminPost;
        },
      },
    };

    expectedUrl = '/posts/admin/47/posts/74';
    transitionTo(router, 'adminPost', admin, adminPost);

    expectedUrl = '/posts/admin/47/posts/75';
    transitionTo(router, 'adminPost', { id: 75 });
  });

  test('tests whether arguments to transitionTo are considered active', function(assert) {
    var admin = { id: 47 },
      adminPost = { id: 74 },
      posts = {
        1: { id: 1 },
        2: { id: 2 },
        3: { id: 3 },
      };

    var adminHandler = {
      serialize: function() {
        return { id: 47 };
      },

      model: function() {
        return admin;
      },
    };

    var adminPostHandler = {
      serialize: function(object) {
        return { post_id: object.id };
      },

      model: function() {
        return adminPost;
      },
    };

    var showPostHandler = {
      serialize: function(object) {
        return (object && { id: object.id }) || null;
      },

      model: function(params) {
        return posts[params.id];
      },
    };

    handlers = {
      admin: adminHandler,
      adminPost: adminPostHandler,
      showPost: showPostHandler,
    };

    // Check for mid-transition correctness.
    // Get a reference to the transition, mid-transition.
    router.willTransition = function() {
      var midTransitionState = router.activeTransition.state;

      // Make sure that the activeIntent doesn't match post 300.
      var isPost300Targeted = router.isActiveIntent(
        'showPost',
        [300],
        null,
        midTransitionState
      );
      assert.notOk(isPost300Targeted, 'Post 300 should not match post 3.');
    };

    // Go to post 3. This triggers our test.
    transitionTo(router, '/posts/3');

    // Clean up.
    delete router.willTransition;

    transitionTo(router, '/posts/1');
    assert.ok(router.isActive('showPost'), 'The showPost handler is active');
    assert.ok(
      router.isActive('showPost', posts[1]),
      'The showPost handler is active with the appropriate context'
    );
    assert.ok(
      !router.isActive('showPost', posts[2]),
      'The showPost handler is inactive when the context is different'
    );
    assert.ok(
      !router.isActive('adminPost'),
      'The adminPost handler is inactive'
    );
    assert.ok(
      !router.isActive('showPost', null),
      'The showPost handler is inactive with a null context'
    );

    transitionTo(router, 'adminPost', admin, adminPost);
    assert.ok(router.isActive('adminPost'), 'The adminPost handler is active');
    assert.ok(
      router.isActive('adminPost', adminPost),
      'The adminPost handler is active with the current context'
    );
    assert.ok(
      router.isActive('adminPost', admin, adminPost),
      'The adminPost handler is active with the current and parent context'
    );
    assert.ok(router.isActive('admin'), 'The admin handler is active');
    assert.ok(
      router.isActive('admin', admin),
      'The admin handler is active with its context'
    );
  });

  test('calling generate on a non-dynamic route does not blow away parent contexts', function(assert) {
    map(assert, function(match) {
      match('/projects').to('projects', function(match) {
        match('/').to('projectsIndex');
        match('/project').to('project', function(match) {
          match('/').to('projectIndex');
        });
      });
    });

    var projects = {};

    handlers = {
      projects: {
        model: function() {
          return projects;
        },
      },
    };

    router.handleURL('/projects').then(function() {
      assert.equal(
        handlers.projects.context,
        projects,
        'projects handler has correct context'
      );
      router.generate('projectIndex');
      assert.equal(
        handlers.projects.context,
        projects,
        'projects handler retains correct context'
      );
    });
  });

  test('calling transitionTo on a dynamic parent route causes non-dynamic child context to be updated', function(assert) {
    map(assert, function(match) {
      match('/project/:project_id').to('project', function(match) {
        match('/').to('projectIndex');
      });
    });

    var projectHandler = {
      model: function(params) {
        delete params.queryParams;
        return params;
      },
    };

    var projectIndexHandler = {
      model: function(params, transition) {
        return transition.resolvedModels.project;
      },
    };

    handlers = {
      project: projectHandler,
      projectIndex: projectIndexHandler,
    };

    transitionTo(router, '/project/1');
    assert.deepEqual(
      projectHandler.context,
      { project_id: '1' },
      'project handler retains correct context'
    );
    assert.deepEqual(
      projectIndexHandler.context,
      { project_id: '1' },
      'project index handler has correct context'
    );

    router.generate('projectIndex', { project_id: '2' });

    assert.deepEqual(
      projectHandler.context,
      { project_id: '1' },
      'project handler retains correct context'
    );
    assert.deepEqual(
      projectIndexHandler.context,
      { project_id: '1' },
      'project index handler retains correct context'
    );

    transitionTo(router, 'projectIndex', { project_id: '2' });
    assert.deepEqual(
      projectHandler.context,
      { project_id: '2' },
      'project handler has updated context'
    );
    assert.deepEqual(
      projectIndexHandler.context,
      { project_id: '2' },
      'project index handler has updated context'
    );
  });

  test('reset exits and clears the current and target route handlers', function(assert) {
    var postIndexExited = false;
    var showAllPostsExited = false;
    var steps = 0;

    assert.equal(++steps, 1);
    var postIndexHandler = {
      exit: function() {
        postIndexExited = true;
        assert.equal(++steps, 4);
      },
    };
    var showAllPostsHandler = {
      exit: function() {
        showAllPostsExited = true;
        assert.equal(++steps, 3);
      },
    };
    handlers = {
      postIndex: postIndexHandler,
      showAllPosts: showAllPostsHandler,
    };

    transitionTo(router, '/posts/all');

    assert.equal(++steps, 2);
    router.reset();

    assert.ok(postIndexExited, 'Post index handler did not exit');
    assert.ok(showAllPostsExited, 'Show all posts handler did not exit');
    assert.equal(
      router.currentHandlerInfos,
      null,
      'currentHandlerInfos should be null'
    );
    assert.equal(
      router.targetHandlerInfos,
      null,
      'targetHandlerInfos should be null'
    );
  });

  test('any of the model hooks can redirect with or without promise', function(assert) {
    assert.expect(26);
    var setupShouldBeEntered = false;
    var returnPromise = false;
    var redirectTo;

    function redirectToAbout() {
      if (returnPromise) {
        return reject().then(null, function() {
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
          assert.ok(
            setupShouldBeEntered,
            'setup should be entered at this time'
          );
        },
      },

      about: {
        setup: function() {
          assert.ok(true, "about handler's setup function was called");
        },
      },

      borf: {
        setup: function() {
          assert.ok(true, 'borf setup entered');
        },
      },
    };

    function testStartup(assert, firstExpectedURL) {
      map(assert, function(match) {
        match('/').to('index');
        match('/about').to('about');
        match('/foo').to('foo');
        match('/borf').to('borf');
      });

      redirectTo = 'about';

      // Perform a redirect on startup.
      expectedUrl = firstExpectedURL || '/about';
      transitionTo(router, '/');

      expectedUrl = '/borf';
      redirectTo = 'borf';

      transitionTo(router, 'index');
    }

    testStartup(assert);

    returnPromise = true;
    testStartup(assert);

    delete handlers.index.beforeModel;
    returnPromise = false;
    testStartup(assert);

    returnPromise = true;
    testStartup(assert);

    delete handlers.index.model;
    returnPromise = false;
    testStartup(assert);

    returnPromise = true;
    testStartup(assert);

    delete handlers.index.afterModel;
    setupShouldBeEntered = true;
    testStartup(assert, '/');
  });

  test('transitionTo with a promise pauses the transition until resolve, passes resolved context to setup', function(assert) {
    handlers = {
      index: {},
      showPost: {
        setup: function(context) {
          assert.deepEqual(
            context,
            { id: 1 },
            'setup receives a resolved context'
          );
        },
      },
    };

    transitionTo(router, '/index');

    transitionTo(
      router,
      'showPost',
      new Promise(function(resolve) {
        resolve({ id: 1 });
      })
    );
  });

  test('error handler gets called for errors in validation hooks', function(assert) {
    assert.expect(25);
    var setupShouldBeEntered = false;
    var expectedReason = { reason: 'No funciona, mon frere.' };

    function throwAnError() {
      return reject(expectedReason);
    }

    handlers = {
      index: {
        beforeModel: throwAnError,
        model: throwAnError,
        afterModel: throwAnError,

        events: {
          error: function(reason) {
            assert.equal(
              reason,
              expectedReason,
              "the value passed to the error handler is what was 'thrown' from the hook"
            );
          },
        },

        setup: function() {
          assert.ok(
            setupShouldBeEntered,
            'setup should be entered at this time'
          );
        },
      },

      about: {
        setup: function() {
          assert.ok(true, "about handler's setup function was called");
        },
      },
    };

    function testStartup(assert) {
      map(assert, function(match) {
        match('/').to('index');
        match('/about').to('about');
      });

      // Perform a redirect on startup.
      return router.handleURL('/').then(null, function(reason) {
        assert.equal(
          reason,
          expectedReason,
          'handleURL error reason is what was originally thrown'
        );

        return router
          .transitionTo('index')
          .then(shouldNotHappen(assert), function(newReason) {
            assert.equal(
              newReason,
              expectedReason,
              'transitionTo error reason is what was originally thrown'
            );
          });
      });
    }

    testStartup(assert)
      .then(function() {
        return testStartup(assert);
      })
      .then(function() {
        delete handlers.index.beforeModel;
        return testStartup(assert);
      })
      .then(function() {
        return testStartup(assert);
      })
      .then(function() {
        delete handlers.index.model;
        return testStartup(assert);
      })
      .then(function() {
        return testStartup(assert);
      })
      .then(function() {
        delete handlers.index.afterModel;
        setupShouldBeEntered = true;
        return testStartup(assert);
      });
  });

  test("Errors shouldn't be handled after proceeding to next child route", function(assert) {
    assert.expect(3);

    map(assert, function(match) {
      match('/parent').to('parent', function(match) {
        match('/articles').to('articles');
        match('/login').to('login');
      });
    });

    handlers = {
      articles: {
        beforeModel: function() {
          assert.ok(true, 'articles beforeModel was entered');
          return reject('blorg');
        },
        events: {
          error: function() {
            assert.ok(true, 'error handled in articles');
            router.transitionTo('login');
          },
        },
      },

      login: {
        setup: function() {
          assert.ok(true, 'login#setup');
        },
      },

      parent: {
        events: {
          error: function() {
            assert.ok(
              false,
              "handled error shouldn't bubble up to parent route"
            );
          },
        },
      },
    };

    router.handleURL('/parent/articles');
  });

  test("Error handling shouldn't trigger for transitions that are already aborted", function(assert) {
    assert.expect(1);

    map(assert, function(match) {
      match('/slow_failure').to('slow_failure');
      match('/good').to('good');
    });

    handlers = {
      slow_failure: {
        model: function() {
          return new Promise(function(res, rej) {
            router.transitionTo('good');
            rej();
          });
        },
        events: {
          error: function() {
            assert.ok(false, "error handling shouldn't fire");
          },
        },
      },

      good: {
        setup: function() {
          assert.ok(true, 'good#setup');
        },
      },
    };

    router.handleURL('/slow_failure');
    flushBackburner();
  });

  test('Transitions to the same destination as the active transition just return the active transition', function(assert) {
    assert.expect(1);

    var transition0 = router.handleURL('/index');
    var transition1 = router.handleURL('/index');
    assert.equal(transition0, transition1);
    flushBackburner();
  });

  test('can redirect from error handler', function(assert) {
    assert.expect(4);

    var errorCount = 0;

    handlers = {
      index: {},

      showPost: {
        model: function() {
          return reject('borf!');
        },
        events: {
          error: function(e) {
            errorCount++;

            assert.equal(e, 'borf!', 'received error thrown from model');

            // Redirect to index.
            router.transitionTo('index').then(function() {
              if (errorCount === 1) {
                // transition back here to test transitionTo error handling.

                return router
                  .transitionTo('showPost', reject('borf!'))
                  .then(shouldNotHappen(assert), function(e) {
                    assert.equal(e, 'borf!', 'got thing');
                  });
              }
            }, shouldNotHappen(assert));
          },
        },

        setup: function() {
          assert.ok(false, 'should not get here');
        },
      },
    };

    router
      .handleURL('/posts/123')
      .then(shouldNotHappen(assert), function(reason) {
        assert.equal(
          reason,
          'borf!',
          'expected reason received from first failed transition'
        );
      });
  });

  test('can redirect from setup/enter', function(assert) {
    assert.expect(5);

    handlers = {
      index: {
        enter: function() {
          assert.ok(true, 'index#enter called');
          router
            .transitionTo('about')
            .then(secondAttempt, shouldNotHappen(assert));
        },
        setup: function() {
          assert.ok(true, 'index#setup called');
          router
            .transitionTo('/about')
            .then(thirdAttempt, shouldNotHappen(assert));
        },
        events: {
          error: function() {
            assert.ok(false, 'redirects should not call error hook');
          },
        },
      },
      about: {
        setup: function() {
          assert.ok(true, 'about#setup was entered');
        },
      },
    };

    router
      .handleURL('/index')
      .then(shouldNotHappen(assert), assertAbort(assert));

    function secondAttempt() {
      delete handlers.index.enter;
      router
        .transitionTo('index')
        .then(shouldNotHappen(assert), assertAbort(assert));
    }

    function thirdAttempt() {
      delete handlers.index.setup;
      router.transitionTo('index').then(null, shouldNotHappen(assert));
    }
  });

  test('redirecting to self from validation hooks should no-op (and not infinite loop)', function(assert) {
    assert.expect(2);

    var count = 0;

    handlers = {
      index: {
        afterModel: function() {
          if (count++ > 10) {
            assert.ok(false, 'infinite loop occurring');
          } else {
            assert.ok(count <= 2, 'running index no more than twice');
            router.transitionTo('index');
          }
        },
        setup: function() {
          assert.ok(true, 'setup was called');
        },
      },
    };

    router.handleURL('/index');
  });

  test('Transition#method(null) prevents URLs from updating', function(assert) {
    assert.expect(1);

    handlers = {
      about: {
        setup: function() {
          assert.ok(true, 'about#setup was called');
        },
      },
    };

    router.updateURL = function() {
      assert.ok(false, "updateURL shouldn't have been called");
    };

    // Test multiple calls to method in a row.
    router.handleURL('/index').method(null);
    router.handleURL('/index').method(null);
    flushBackburner();

    router.transitionTo('about').method(null);
    flushBackburner();
  });

  test('redirecting to self from enter hooks should no-op (and not infinite loop)', function(assert) {
    assert.expect(1);

    var count = 0;

    handlers = {
      index: {
        setup: function() {
          if (count++ > 10) {
            assert.ok(false, 'infinite loop occurring');
          } else {
            assert.ok(true, 'setup was called');
            router.transitionTo('index');
          }
        },
      },
    };

    router.handleURL('/index');
  });

  test('redirecting to child handler from validation hooks should no-op (and not infinite loop)', function(assert) {
    assert.expect(4);

    handlers = {
      postIndex: {
        beforeModel: function() {
          assert.ok(true, 'postIndex beforeModel called');
          router.transitionTo('showAllPosts');
        },
      },

      showAllPosts: {
        beforeModel: function() {
          assert.ok(true, 'showAllPosts beforeModel called');
        },
      },

      showPopularPosts: {
        beforeModel: function() {
          assert.ok(true, 'showPopularPosts beforeModel called');
        },
      },
    };

    router.handleURL('/posts/popular').then(
      function() {
        assert.ok(false, 'redirected handleURL should not succeed');
      },
      function() {
        assert.ok(true, 'redirected handleURL should fail');
      }
    );
  });

  function startUpSetup(assert) {
    handlers = {
      index: {
        setup: function() {
          assert.ok(true, 'index setup called');
        },
      },
      about: {
        setup: function() {
          assert.ok(true, 'about setup called');
        },
      },
      faq: {
        setup: function() {
          assert.ok(true, 'faq setup called');
        },
      },
    };
  }

  test('transitionTo with named transition can be called at startup', function(assert) {
    assert.expect(2);

    startUpSetup(assert);

    router.transitionTo('index').then(
      function() {
        assert.ok(true, 'success handler called');
      },
      function() {
        assert.ok(false, 'failure handle should not be called');
      }
    );
  });

  test('transitionTo with URL transition can be called at startup', function(assert) {
    assert.expect(2);

    startUpSetup(assert);

    router.transitionTo('/index').then(
      function() {
        assert.ok(true, 'success handler called');
      },
      function() {
        assert.ok(false, 'failure handle should not be called');
      }
    );
  });

  test('transitions fire a didTransition event on the destination route', function(assert) {
    assert.expect(1);

    handlers = {
      about: {
        events: {
          didTransition: function() {
            assert.ok(true, "index's didTransition was called");
          },
        },
      },
    };

    router.handleURL('/index').then(function() {
      router.transitionTo('about');
    }, shouldNotHappen(assert));
  });

  test('willTransition function fired before route change', function(assert) {
    assert.expect(1);

    var beforeModelNotCalled = true;

    handlers = {
      about: {
        beforeModel: function() {
          beforeModelNotCalled = false;
        },
      },
    };

    router.willTransition = function() {
      assert.ok(
        beforeModelNotCalled,
        'about beforeModel hook should not be called at this time'
      );
    };

    router.handleURL('/about');
  });

  test('willTransition function fired with handler infos passed in', function(assert) {
    assert.expect(2);

    router.handleURL('/about').then(function() {
      router.willTransition = function(fromInfos, toInfos) {
        assert.equal(
          routePath(fromInfos),
          'about',
          'first argument should be the old handler infos'
        );
        assert.equal(
          routePath(toInfos),
          'postIndex.showPopularPosts',
          'second argument should be the new handler infos'
        );
      };

      router.handleURL('/posts/popular');
    });
  });

  test('willTransition function fired with cancellable transition passed in', function(assert) {
    assert.expect(2);

    router.handleURL('/index').then(function() {
      router.willTransition = function(fromInfos, toInfos, transition) {
        assert.ok(true, "index's transitionTo was called");
        transition.abort();
      };

      return router
        .transitionTo('about')
        .then(shouldNotHappen(assert), assertAbort(assert));
    });
  });

  test('transitions can be aborted in the willTransition event', function(assert) {
    assert.expect(3);

    handlers = {
      index: {
        setup: function() {
          assert.ok(true, 'index setup called');
        },
        events: {
          willTransition: function(transition) {
            assert.ok(true, "index's transitionTo was called");
            transition.abort();
          },
        },
      },
      about: {
        setup: function() {
          assert.ok(true, 'about setup called');
        },
      },
    };

    router.handleURL('/index').then(function() {
      return router
        .transitionTo('about')
        .then(shouldNotHappen(assert), assertAbort(assert));
    });
  });

  test('transitions can redirected in the willTransition event', function(assert) {
    assert.expect(2);

    var destFlag = true;

    handlers = {
      index: {
        setup: function() {
          assert.ok(true, 'index setup called');
        },
        events: {
          willTransition: function() {
            // Router code must be careful here not to refire
            // `willTransition` when a transition is already
            // underway, else infinite loop.
            var dest = destFlag ? 'about' : 'faq';
            destFlag = !destFlag;
            router.transitionTo(dest);
          },
        },
      },
      about: {
        setup: function() {
          assert.ok(true, 'about setup called');
        },
      },
      faq: {
        setup: function() {
          assert.ok(false, 'faq setup should not be called');
        },
      },
    };

    router.handleURL('/index').then(function() {
      router.transitionTo('faq');
    });
  });

  test('aborted transitions can be saved and later retried', function(assert) {
    assert.expect(9);

    var shouldPrevent = true,
      transitionToAbout,
      lastTransition,
      retryTransition;

    handlers = {
      index: {
        setup: function() {
          assert.ok(true, 'index setup called');
        },
        events: {
          willTransition: function(transition) {
            assert.ok(true, "index's willTransition was called");
            if (shouldPrevent) {
              transition.data.foo = 'hello';
              transition.foo = 'hello';
              transition.abort();
              lastTransition = transition;
            } else {
              assert.ok(
                !transition.foo,
                'no foo property exists on new transition'
              );
              assert.equal(
                transition.data.foo,
                'hello',
                'values stored in data hash of old transition persist when retried'
              );
            }
          },
        },
      },
      about: {
        setup: function() {
          assert.ok(true, 'about setup called');
        },
      },
    };

    router.handleURL('/index').then(function() {
      router
        .transitionTo('about')
        .then(shouldNotHappen(assert), function() {
          assert.ok(true, 'transition was blocked');
          shouldPrevent = false;
          transitionToAbout = lastTransition;
          retryTransition = transitionToAbout.retry();
          assert.equal(retryTransition.urlMethod, 'update');
          return retryTransition;
        })
        .then(function() {
          assert.ok(true, 'transition succeeded via .retry()');
        }, shouldNotHappen(assert));
    });
  });

  test('if an aborted transition is retried, it preserves the urlMethod of the original one', function(assert) {
    assert.expect(9);

    var shouldPrevent = true,
      transitionToAbout,
      lastTransition,
      retryTransition;

    handlers = {
      index: {
        setup: function() {
          assert.ok(true, 'index setup called');
        },
        events: {
          willTransition: function(transition) {
            assert.ok(true, "index's willTransition was called");
            if (shouldPrevent) {
              transition.data.foo = 'hello';
              transition.foo = 'hello';
              transition.abort();
              lastTransition = transition;
            } else {
              assert.ok(
                !transition.foo,
                'no foo property exists on new transition'
              );
              assert.equal(
                transition.data.foo,
                'hello',
                'values stored in data hash of old transition persist when retried'
              );
            }
          },
        },
      },
      about: {
        setup: function() {
          assert.ok(true, 'about setup called');
        },
      },
    };

    router.handleURL('/index').then(function() {
      router
        .replaceWith('about')
        .then(shouldNotHappen(assert), function() {
          assert.ok(true, 'transition was blocked');
          shouldPrevent = false;
          transitionToAbout = lastTransition;
          retryTransition = transitionToAbout.retry();
          assert.equal(retryTransition.urlMethod, 'replace');
          return transitionToAbout.retry();
        })
        .then(function() {
          assert.ok(true, 'transition succeeded via .retry()');
        }, shouldNotHappen(assert));
    });
  });

  test('if an initial transition is aborted during validation phase and later retried', function(assert) {
    assert.expect(7);

    var shouldRedirectToLogin = true;
    var currentURL = '/login';
    var urlStack = [];
    var lastTransition;

    map(assert, function(match) {
      match('/').to('index');
      match('/login').to('login');
    });

    router.updateURL = function(url) {
      urlStack.push(['updateURL', url]);
      currentURL = url;
    };

    router.replaceURL = function(url) {
      urlStack.push(['replaceURL', url]);
      currentURL = url;
    };

    handlers = {
      index: {
        beforeModel: function(transition) {
          assert.ok(true, 'index model called');
          if (shouldRedirectToLogin) {
            lastTransition = transition;
            return router.transitionTo('/login');
          }
        },
      },
      login: {
        setup: function() {
          assert.ok('login setup called');
        },
      },
    };

    // use `handleURL` to emulate initial transition properly
    handleURL(router, '/')
      .then(shouldNotHappen(assert, 'initial transition aborted'), function() {
        assert.equal(currentURL, '/login', 'currentURL matches');
        assert.deepEqual(urlStack, [['replaceURL', '/login']]);

        shouldRedirectToLogin = false;
        return lastTransition.retry();
      })
      .then(function() {
        assert.equal(currentURL, '/', 'after retry currentURL is updated');
        assert.deepEqual(urlStack, [
          ['replaceURL', '/login'],
          ['updateURL', '/'],
        ]);
      }, shouldNotHappen(assert, 'final catch'));
  });

  test('completed transitions can be saved and later retried', function(assert) {
    assert.expect(3);

    var post = { id: '123' },
      savedTransition;

    handlers = {
      showPost: {
        afterModel: function(model, transition) {
          assert.equal(
            model,
            post,
            "showPost's afterModel got the expected post model"
          );
          savedTransition = transition;
        },
      },
      index: {},
      about: {
        setup: function() {
          assert.ok(true, 'setup was entered');
        },
      },
    };

    router
      .handleURL('/index')
      .then(function() {
        return router.transitionTo('showPost', post);
      })
      .then(function() {
        return router.transitionTo('about');
      })
      .then(function() {
        return savedTransition.retry();
      });
  });

  function setupAuthenticatedExample(assert) {
    map(assert, function(match) {
      match('/index').to('index');
      match('/login').to('login');

      match('/admin').to('admin', function(match) {
        match('/about').to('about');
        match('/posts/:post_id').to('adminPost');
      });
    });

    var isLoggedIn = false,
      lastRedirectedTransition;

    handlers = {
      index: {},
      login: {
        events: {
          logUserIn: function() {
            isLoggedIn = true;
            lastRedirectedTransition.retry();
          },
        },
      },
      admin: {
        beforeModel: function(transition) {
          lastRedirectedTransition = transition;
          assert.ok(true, 'beforeModel redirect was called');
          if (!isLoggedIn) {
            router.transitionTo('login');
          }
        },
      },
      about: {
        setup: function() {
          assert.ok(isLoggedIn, 'about was entered only after user logged in');
        },
      },
      adminPost: {
        model: function(params) {
          assert.deepEqual(
            params,
            { post_id: '5', queryParams: {} },
            'adminPost received params previous transition attempt'
          );
          return 'adminPost';
        },
        setup: function(model) {
          assert.equal(
            model,
            'adminPost',
            'adminPost was entered with correct model'
          );
        },
      },
    };
  }

  test('authenticated routes: starting on non-auth route', function(assert) {
    assert.expect(8);

    setupAuthenticatedExample(assert);

    transitionTo(router, '/index');
    transitionToWithAbort(assert, router, 'about');
    transitionToWithAbort(assert, router, 'about');
    transitionToWithAbort(assert, router, '/admin/about');

    // Log in. This will retry the last failed transition to 'about'.
    router.trigger('logUserIn');
  });

  test('authenticated routes: starting on auth route', function(assert) {
    assert.expect(8);

    setupAuthenticatedExample(assert);

    transitionToWithAbort(assert, router, '/admin/about');
    transitionToWithAbort(assert, router, '/admin/about');
    transitionToWithAbort(assert, router, 'about');

    // Log in. This will retry the last failed transition to 'about'.
    router.trigger('logUserIn');
  });

  test('authenticated routes: starting on parameterized auth route', function(assert) {
    assert.expect(5);

    setupAuthenticatedExample(assert);

    transitionToWithAbort(assert, router, '/admin/posts/5');

    // Log in. This will retry the last failed transition to '/posts/5'.
    router.trigger('logUserIn');
  });

  test('An instantly aborted transition fires no hooks', function(assert) {
    assert.expect(7);

    var hooksShouldBeCalled = false;

    handlers = {
      index: {
        beforeModel: function() {
          assert.ok(
            hooksShouldBeCalled,
            'index beforeModel hook should be called at this time'
          );
        },
      },
      about: {
        beforeModel: function() {
          assert.ok(
            hooksShouldBeCalled,
            'about beforeModel hook should be called at this time'
          );
        },
      },
    };

    router
      .transitionTo('index')
      .abort()
      .then(shouldNotHappen(assert), function() {
        assert.ok(true, 'Failure handler called for index');
        return router.transitionTo('/index').abort();
      })
      .then(shouldNotHappen(assert), function() {
        assert.ok(true, 'Failure handler called for /index');
        hooksShouldBeCalled = true;
        return router.transitionTo('index');
      })
      .then(function() {
        assert.ok(true, 'Success handler called for index');
        hooksShouldBeCalled = false;
        return router.transitionTo('about').abort();
      }, shouldNotHappen(assert))
      .then(
        shouldNotHappen(assert),
        function() {
          assert.ok(true, 'failure handler called for about');
          return router.transitionTo('/about').abort();
        },
        shouldNotHappen(assert)
      )
      .then(shouldNotHappen(assert), function() {
        assert.ok(true, 'failure handler called for /about');
        hooksShouldBeCalled = true;
        return router.transitionTo('/about');
      });
  });

  test('a successful transition resolves with the target handler', function(assert) {
    assert.expect(2);

    // Note: this is extra convenient for Ember where you can all
    // .transitionTo right on the route.

    handlers = {
      index: { borfIndex: true },
      about: { borfAbout: true },
    };

    router
      .handleURL('/index')
      .then(function(result) {
        assert.ok(result.borfIndex, 'resolved to index handler');
        return router.transitionTo('about');
      }, shouldNotHappen(assert))
      .then(function(result) {
        assert.ok(result.borfAbout, 'resolved to about handler');
      });
  });

  test('transitions have a .promise property', function(assert) {
    assert.expect(2);

    router
      .handleURL('/index')
      .promise.then(function() {
        var promise = router.transitionTo('about').abort().promise;
        assert.ok(promise, 'promise exists on aborted transitions');
        return promise;
      }, shouldNotHappen(assert))
      .then(shouldNotHappen(assert), function() {
        assert.ok(true, 'failure handler called');
      });
  });

  test('the serialize function is bound to the correct object when called', function(assert) {
    assert.expect(scenario.async ? 0 : 1);

    handlers = {
      showPostsForDate: {
        serialize: function(date) {
          assert.equal(this, handlers.showPostsForDate);
          return {
            date:
              date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate(),
          };
        },
      },
    };

    router.generate('showPostsForDate', new Date(1815, 5, 18));
  });

  test('transitionTo will soak up resolved parent models of active transition', function(assert) {
    assert.expect(5);

    var admin = { id: 47 },
      adminPost = { id: 74 },
      adminSetupShouldBeEntered = false;

    function adminPromise() {
      return new Promise(function(res) {
        res(admin);
      });
    }

    var adminHandler = {
      serialize: function(object) {
        assert.equal(
          object.id,
          47,
          'The object passed to serialize is correct'
        );
        return { id: 47 };
      },

      model: function(params) {
        assert.equal(
          params.id,
          47,
          'The object passed to serialize is correct'
        );
        return admin;
      },

      setup: function() {
        assert.ok(
          adminSetupShouldBeEntered,
          "adminHandler's setup should be called at this time"
        );
      },
    };

    var adminPostHandler = {
      serialize: function(object) {
        return { post_id: object.id };
      },

      setup: function() {
        assert.equal(
          adminHandler.context,
          admin,
          'adminPostHandler receives resolved soaked promise from previous transition'
        );
      },

      model: function() {
        return adminPost;
      },
    };

    var adminPostsHandler = {
      beforeModel: function() {
        adminSetupShouldBeEntered = true;
        router.transitionTo('adminPost', adminPost);
      },
    };

    var indexHandler = {
      setup: function() {
        assert.ok(true, 'index entered');
      },
    };

    handlers = {
      index: indexHandler,
      admin: adminHandler,
      adminPost: adminPostHandler,
      adminPosts: adminPostsHandler,
    };

    router.transitionTo('index').then(function() {
      router
        .transitionTo('adminPosts', adminPromise())
        .then(shouldNotHappen(assert), assertAbort(assert));
    });
  });

  test("transitionTo will soak up resolved all models of active transition, including present route's resolved model", function(assert) {
    assert.expect(2);

    var modelCalled = 0,
      hasRedirected = false;

    map(assert, function(match) {
      match('/post').to('post', function(match) {
        match('/').to('postIndex');
        match('/new').to('postNew');
      });
    });

    var postHandler = {
      model: function() {
        assert.equal(
          modelCalled++,
          0,
          "postHandler's model should only be called once"
        );
        return { title: 'Hello world' };
      },

      redirect: function() {
        if (!hasRedirected) {
          hasRedirected = true;
          router.transitionTo('postNew');
        }
      },
    };

    handlers = {
      post: postHandler,
      postIndex: {},
      postNew: {},
    };

    router
      .transitionTo('postIndex')
      .then(shouldNotHappen(assert), assertAbort(assert));
  });

  test("can reference leaf '/' route by leaf or parent name", function(assert) {
    map(assert, function(match) {
      match('/').to('app', function(match) {
        match('/').to('index');
        match('/nest').to('nest', function(match) {
          match('/').to('nest.index');
        });
      });
    });

    function assertOnRoute(name) {
      var last =
        router.currentHandlerInfos[router.currentHandlerInfos.length - 1];
      assert.equal(last.name, name);
    }

    transitionTo(router, 'app');
    assertOnRoute('index');
    transitionTo(router, 'nest');
    assertOnRoute('nest.index');
    transitionTo(router, 'app');
    assertOnRoute('index');
  });

  test('resolved models can be swapped out within afterModel', function(assert) {
    assert.expect(3);

    var modelPre = {},
      modelPost = {};

    handlers = {
      index: {
        model: function() {
          return modelPre;
        },
        afterModel: function(resolvedModel, transition) {
          assert.equal(
            resolvedModel,
            transition.resolvedModels.index,
            "passed-in resolved model equals model in transition's hash"
          );
          assert.equal(
            resolvedModel,
            modelPre,
            'passed-in resolved model equals model returned from `model`'
          );
          transition.resolvedModels.index = modelPost;
        },
        setup: function(model) {
          assert.equal(
            model,
            modelPost,
            'the model passed to `setup` is the one substituted in afterModel'
          );
        },
      },
    };

    router.transitionTo('index');
  });

  test('String/number args in transitionTo are treated as url params', function(assert) {
    assert.expect(11);

    var adminParams = { id: '1' },
      adminModel = { id: '1' },
      adminPostModel = { id: '2' };

    handlers = {
      admin: {
        model: function(params) {
          delete params.queryParams;
          assert.deepEqual(
            params,
            adminParams,
            'admin handler gets the number passed in via transitionTo, converts to string'
          );
          return adminModel;
        },
      },
      adminPost: {
        model: function(params) {
          delete params.queryParams;
          assert.deepEqual(
            params,
            { post_id: '2' },
            'adminPost handler gets the string passed in via transitionTo'
          );
          return adminPostModel;
        },
        setup: function() {
          assert.ok(true, 'adminPost setup was entered');
        },
      },
    };

    router
      .handleURL('/index')
      .then(function() {
        expectedUrl = '/posts/admin/1/posts/2';
        return router.transitionTo('adminPost', 1, '2');
      })
      .then(function() {
        assert.ok(
          router.isActive('adminPost', 1, '2'),
          'adminPost is active via params'
        );
        assert.ok(
          router.isActive('adminPost', 1, adminPostModel),
          'adminPost is active via contexts'
        );

        adminParams = { id: '0' };
        expectedUrl = '/posts/admin/0/posts/2';
        return router.transitionTo('adminPost', 0, '2');
      })
      .then(function() {
        assert.ok(
          router.isActive('adminPost', 0, '2'),
          'adminPost is active via params'
        );
        assert.ok(
          router.isActive('adminPost', 0, adminPostModel),
          'adminPost is active via contexts'
        );
      }, shouldNotHappen(assert));
  });

  test("Transitions returned from beforeModel/model/afterModel hooks aren't treated as pausing promises", function(assert) {
    assert.expect(6);

    handlers = {
      index: {
        beforeModel: function() {
          assert.ok(true, 'index beforeModel called');
          return router.transitionTo('index');
        },
        model: function() {
          assert.ok(true, 'index model called');
          return router.transitionTo('index');
        },
        afterModel: function() {
          assert.ok(true, 'index afterModel called');
          return router.transitionTo('index');
        },
      },
    };

    function testStartup(assert) {
      map(assert, function(match) {
        match('/index').to('index');
      });

      return router.handleURL('/index');
    }

    testStartup(assert)
      .then(function() {
        delete handlers.index.beforeModel;
        return testStartup(assert);
      })
      .then(function() {
        delete handlers.index.model;
        return testStartup(assert);
      })
      .then(function() {
        delete handlers.index.afterModel;
        return testStartup(assert);
      });
  });

  /* TODO: revisit this idea
test("exceptions thrown from model hooks aren't swallowed", function(assert) {
  assert.expect(7);

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
    assert.ok(!routeWasEntered, "route hasn't been entered yet");
    delete handlers.index[hooks.shift()];
  }

  router.transitionTo('index');
  flush(anError);

  assert.ok(routeWasEntered, "route was finally entered");
});
*/

  test('Transition#followRedirects() returns a promise that fulfills when any redirecting transitions complete', function(assert) {
    assert.expect(3);

    handlers.about = {
      redirect: function() {
        router.transitionTo('faq').then(null, shouldNotHappen(assert));
      },
    };

    router
      .transitionTo('/index')
      .followRedirects()
      .then(function(handler) {
        assert.equal(
          handler,
          handlers.index,
          'followRedirects works with non-redirecting transitions'
        );

        return router.transitionTo('about').followRedirects();
      })
      .then(function(handler) {
        assert.equal(
          handler,
          handlers.faq,
          'followRedirects promise resolved with redirected faq handler'
        );

        handlers.about.beforeModel = function(transition) {
          transition.abort();
        };

        // followRedirects should just reject for non-redirecting transitions.
        return router
          .transitionTo('about')
          .followRedirects()
          .then(shouldNotHappen(assert), assertAbort(assert));
      });
  });

  test("Returning a redirecting Transition from a model hook doesn't cause things to explode", function(assert) {
    assert.expect(2);

    handlers.index = {
      beforeModel: function() {
        return router.transitionTo('about');
      },
    };

    handlers.about = {
      setup: function() {
        assert.ok(true, 'about#setup was called');
      },
    };

    router.transitionTo('/index').then(null, assertAbort(assert));
  });

  test('Generate works w queryparams', function(assert) {
    assert.equal(router.generate('index'), '/index', 'just index');
    assert.equal(
      router.generate('index', { queryParams: { foo: '123' } }),
      '/index?foo=123',
      'just index'
    );
    assert.equal(
      router.generate('index', { queryParams: { foo: '123', bar: '456' } }),
      '/index?bar=456&foo=123',
      'just index'
    );
  });

  if (scenario.async) {
    test('Generate does not invoke getHandler', function(assert) {
      var originalGetHandler = router.getHandler;
      router.getHandler = function() {
        assert.ok(false, 'getHandler should not be called');
      };

      assert.equal(router.generate('index'), '/index', 'just index');
      assert.equal(
        router.generate('index', { queryParams: { foo: '123' } }),
        '/index?foo=123',
        'just index'
      );
      assert.equal(
        router.generate('index', { queryParams: { foo: '123', bar: '456' } }),
        '/index?bar=456&foo=123',
        'just index'
      );

      router.getHandler = originalGetHandler;
    });
  }

  test('errors in enter/setup hooks fire `error`', function(assert) {
    assert.expect(4);

    var count = 0;

    handlers = {
      index: {
        enter: function() {
          throw 'OMG ENTER';
        },
        setup: function() {
          throw 'OMG SETUP';
        },
        events: {
          error: function(e) {
            if (count === 0) {
              assert.equal(
                e,
                'OMG ENTER',
                "enter's throw value passed to error hook"
              );
            } else if (count === 1) {
              assert.equal(
                e,
                'OMG SETUP',
                "setup's throw value passed to error hook"
              );
            } else {
              assert.ok(false, 'should not happen');
            }
          },
        },
      },
    };

    router
      .handleURL('/index')
      .then(shouldNotHappen(assert), function(reason) {
        assert.equal(reason, 'OMG ENTER', "enters's error was propagated");
        count++;
        delete handlers.index.enter;
        return router.handleURL('/index');
      })
      .then(shouldNotHappen(assert), function(reason) {
        assert.equal(reason, 'OMG SETUP', "setup's error was propagated");
        delete handlers.index.setup;
      });
  });

  test('invalidating parent model with different string/numeric parameters invalidates children', function(assert) {
    map(assert, function(match) {
      match('/:p').to('parent', function(match) {
        match('/:c').to('child');
      });
    });

    assert.expect(8);

    var count = 0;
    handlers = {
      parent: {
        model: function(params) {
          assert.ok(true, 'parent model called');
          return { id: params.p };
        },
        setup: function(model) {
          if (count === 0) {
            assert.deepEqual(model, { id: '1' });
          } else {
            assert.deepEqual(model, { id: '2' });
          }
        },
      },
      child: {
        model: function(params) {
          assert.ok(true, 'child model called');
          return { id: params.c };
        },
        setup: function(model) {
          if (count === 0) {
            assert.deepEqual(model, { id: '1' });
          } else {
            assert.deepEqual(model, { id: '1' });
          }
        },
      },
    };

    transitionTo(router, 'child', '1', '1');
    count = 1;
    transitionTo(router, 'child', '2', '1');
  });

  test('intents make use of previous transition state in case not enough contexts are provided to retry a transition', function(assert) {
    assert.expect(3);

    map(assert, function(match) {
      match('/').to('application', function(match) {
        match('/users/:user').to('user', function(match) {
          match('/index').to('userIndex');
          match('/auth').to('auth');
        });
        match('/login').to('login');
      });
    });

    var hasAuthed = false,
      savedTransition,
      didFinish = false;
    handlers = {
      auth: {
        beforeModel: function(transition) {
          if (!hasAuthed) {
            savedTransition = transition;
            router.transitionTo('login');
          }
        },
        setup: function() {
          didFinish = true;
        },
      },
    };

    transitionTo(router, 'userIndex', { user: 'machty' });

    // Then attempt to transition into auth; this will redirect.
    transitionTo(router, 'auth');
    assert.ok(savedTransition, 'transition was saved');

    hasAuthed = true;
    savedTransition.retry();
    flushBackburner();

    assert.ok(didFinish, 'did enter auth route');
    assert.equal(
      handlers.user.context.user,
      'machty',
      'User was remembered upon retry'
    );
  });

  test('A failed transition calls the catch and finally callbacks', function(assert) {
    assert.expect(2);

    map(assert, function(match) {
      match('/').to('application', function(match) {
        match('/bad').to('badRoute');
      });
    });

    handlers = {
      badRoute: {
        beforeModel: function() {
          return new Promise(function(resolve, reject) {
            reject('example reason');
          });
        },
      },
    };

    router
      .handleURL('/bad')
      .catch(function() {
        assert.ok(true, 'catch callback was called');
      })
      .finally(function() {
        assert.ok(true, 'finally callback was called');
      });
    flushBackburner();
  });

  test('underscore-prefixed hooks are preferred over non-prefixed', function(assert) {
    assert.expect(2);

    handlers = {
      showPost: {
        _model: function() {
          assert.ok(true);
          return {};
        },

        _setup: function() {
          assert.ok(true);
        },
      },
    };

    router.handleURL('/posts/1');
  });

  test('A successful transition calls the finally callback', function(assert) {
    assert.expect(1);

    map(assert, function(match) {
      match('/').to('application', function(match) {
        match('/example').to('exampleRoute');
      });
    });

    router.handleURL('/example').finally(function() {
      assert.ok(true, 'finally callback was called');
    });
  });

  test('transition sets isActive by default', function(assert) {
    assert.expect(2);

    map(assert, function(match) {
      match('/').to('application', function(match) {
        match('/example').to('exampleRoute');
      });
    });

    var transition = router.handleURL('/example');

    assert.equal(transition.isActive, true);
    assert.equal(transition.isAborted, false);
  });

  test('transition sets isActive to false when aborted', function(assert) {
    assert.expect(4);

    map(assert, function(match) {
      match('/').to('application', function(match) {
        match('/example').to('exampleRoute');
      });
    });

    var transition = router.handleURL('/example');

    assert.equal(transition.isActive, true, 'precond');
    assert.equal(transition.isAborted, false, 'precond');

    transition.abort();

    assert.equal(
      transition.isActive,
      false,
      'isActive should be false after abort'
    );
    assert.equal(
      transition.isAborted,
      true,
      'isAborted is set to true after abort'
    );
  });

  if (scenario.async) {
    test('getHandler is invoked synchronously when returning Promises', function(assert) {
      assert.expect(2);

      var count = 0;
      var handlerCount = 2;

      router.getHandler = function() {
        count++;

        return scenario.getHandler.apply(null, arguments).then(function() {
          assert.equal(count, handlerCount);
        });
      };

      router.transitionTo('/posts/all');
    });
  }

  module('Multiple dynamic segments per route (' + scenario.name + ')');

  test('Multiple string/number params are soaked up', function(assert) {
    assert.expect(3);

    map(assert, function(match) {
      match('/:foo_id/:bar_id').to('bar');
    });

    handlers = {
      bar: {
        model: function() {
          return {};
        },
      },
    };

    expectedUrl = '/omg/lol';
    transitionTo(router, 'bar', 'omg', 'lol');

    expectedUrl = '/omg/heehee';
    transitionTo(router, 'bar', 'heehee');

    expectedUrl = '/lol/no';
    transitionTo(router, 'bar', 'lol', 'no');
  });

  module('isActive (' + scenario.name + ')', {
    setup: function(assert) {
      handlers = {
        parent: {
          serialize: function(obj) {
            return {
              one: obj.one,
              two: obj.two,
            };
          },
        },
        child: {
          serialize: function(obj) {
            return {
              three: obj.three,
              four: obj.four,
            };
          },
        },
      };

      // When using an async getHandler serializers need to be loaded separately
      if (scenario.async) {
        serializers = {
          parent: function(obj) {
            return {
              one: obj.one,
              two: obj.two,
            };
          },
          child: function(obj) {
            return {
              three: obj.three,
              four: obj.four,
            };
          },
        };
      }

      map(assert, function(match) {
        match('/:one/:two').to('parent', function(match) {
          match('/:three/:four').to('child');
        });
      });

      expectedUrl = null;

      transitionTo(router, 'child', 'a', 'b', 'c', 'd');
    },
  });

  test('isActive supports multiple soaked up string/number params (via params)', function(assert) {
    assert.ok(router.isActive('child'), 'child');
    assert.ok(router.isActive('parent'), 'parent');

    assert.ok(router.isActive('child', 'd'), 'child d');
    assert.ok(router.isActive('child', 'c', 'd'), 'child c d');
    assert.ok(router.isActive('child', 'b', 'c', 'd'), 'child b c d');
    assert.ok(router.isActive('child', 'a', 'b', 'c', 'd'), 'child a b c d');

    assert.ok(!router.isActive('child', 'e'), '!child e');
    assert.ok(!router.isActive('child', 'c', 'e'), '!child c e');
    assert.ok(!router.isActive('child', 'e', 'd'), '!child e d');
    assert.ok(!router.isActive('child', 'x', 'x'), '!child x x');
    assert.ok(!router.isActive('child', 'b', 'c', 'e'), '!child b c e');
    assert.ok(!router.isActive('child', 'b', 'e', 'd'), 'child b e d');
    assert.ok(!router.isActive('child', 'e', 'c', 'd'), 'child e c d');
    assert.ok(!router.isActive('child', 'a', 'b', 'c', 'e'), 'child a b c e');
    assert.ok(!router.isActive('child', 'a', 'b', 'e', 'd'), 'child a b e d');
    assert.ok(!router.isActive('child', 'a', 'e', 'c', 'd'), 'child a e c d');
    assert.ok(!router.isActive('child', 'e', 'b', 'c', 'd'), 'child e b c d');

    assert.ok(router.isActive('parent', 'b'), 'parent b');
    assert.ok(router.isActive('parent', 'a', 'b'), 'parent a b');

    assert.ok(!router.isActive('parent', 'c'), '!parent c');
    assert.ok(!router.isActive('parent', 'a', 'c'), '!parent a c');
    assert.ok(!router.isActive('parent', 'c', 'b'), '!parent c b');
    assert.ok(!router.isActive('parent', 'c', 't'), '!parent c t');
  });

  test('isActive supports multiple soaked up string/number params (via serialized objects)', function(assert) {
    assert.ok(
      router.isActive('child', { three: 'c', four: 'd' }),
      'child(3:c, 4:d)'
    );
    assert.ok(
      !router.isActive('child', { three: 'e', four: 'd' }),
      '!child(3:e, 4:d)'
    );
    assert.ok(
      !router.isActive('child', { three: 'c', four: 'e' }),
      '!child(3:c, 4:e)'
    );
    assert.ok(!router.isActive('child', { three: 'c' }), '!child(3:c)');
    assert.ok(!router.isActive('child', { four: 'd' }), '!child(4:d)');
    assert.ok(!router.isActive('child', {}), '!child({})');

    assert.ok(
      router.isActive('parent', { one: 'a', two: 'b' }),
      'parent(1:a, 2:b)'
    );
    assert.ok(
      !router.isActive('parent', { one: 'e', two: 'b' }),
      '!parent(1:e, 2:b)'
    );
    assert.ok(
      !router.isActive('parent', { one: 'a', two: 'e' }),
      '!parent(1:a, 2:e)'
    );
    assert.ok(!router.isActive('parent', { one: 'a' }), '!parent(1:a)');
    assert.ok(!router.isActive('parent', { two: 'b' }), '!parent(2:b)');

    assert.ok(
      router.isActive(
        'child',
        { one: 'a', two: 'b' },
        { three: 'c', four: 'd' }
      ),
      'child(1:a, 2:b, 3:c, 4:d)'
    );
    assert.ok(
      !router.isActive(
        'child',
        { one: 'e', two: 'b' },
        { three: 'c', four: 'd' }
      ),
      '!child(1:e, 2:b, 3:c, 4:d)'
    );
    assert.ok(
      !router.isActive(
        'child',
        { one: 'a', two: 'b' },
        { three: 'c', four: 'e' }
      ),
      '!child(1:a, 2:b, 3:c, 4:e)'
    );
  });

  test('isActive supports multiple soaked up string/number params (mixed)', function(assert) {
    assert.ok(router.isActive('child', 'a', 'b', { three: 'c', four: 'd' }));
    assert.ok(router.isActive('child', 'b', { three: 'c', four: 'd' }));
    assert.ok(!router.isActive('child', 'a', { three: 'c', four: 'd' }));
    assert.ok(router.isActive('child', { one: 'a', two: 'b' }, 'c', 'd'));
    assert.ok(router.isActive('child', { one: 'a', two: 'b' }, 'd'));
    assert.ok(!router.isActive('child', { one: 'a', two: 'b' }, 'c'));

    assert.ok(!router.isActive('child', 'a', 'b', { three: 'e', four: 'd' }));
    assert.ok(!router.isActive('child', 'b', { three: 'e', four: 'd' }));
    assert.ok(!router.isActive('child', { one: 'e', two: 'b' }, 'c', 'd'));
    assert.ok(!router.isActive('child', { one: 'e', two: 'b' }, 'd'));
  });

  module('Preservation of params between redirects (' + scenario.name + ')', {
    setup: function(assert) {
      expectedUrl = null;

      map(assert, function(match) {
        match('/').to('index');
        match('/:foo_id').to('foo', function(match) {
          match('/').to('fooIndex');
          match('/:bar_id').to('bar', function(match) {
            match('/').to('barIndex');
          });
        });
      });

      handlers = {
        foo: {
          model: function(params) {
            this.modelCount = this.modelCount ? this.modelCount + 1 : 1;
            return { id: params.foo_id };
          },
          afterModel: function() {
            router.transitionTo('barIndex', '789');
          },
        },

        bar: {
          model: function(params) {
            this.modelCount = this.modelCount ? this.modelCount + 1 : 1;
            return { id: params.bar_id };
          },
        },
      };
    },
  });

  test("Starting on '/' root index", function(assert) {
    transitionTo(router, '/');

    // Should call model for foo and bar
    expectedUrl = '/123/789';
    transitionTo(router, 'barIndex', '123', '456');

    assert.equal(
      handlers.foo.modelCount,
      2,
      'redirect in foo#afterModel should run foo#model twice (since validation failed)'
    );

    assert.deepEqual(handlers.foo.context, { id: '123' });
    assert.deepEqual(
      handlers.bar.context,
      { id: '789' },
      'bar should have redirected to bar 789'
    );

    // Try setting foo's context to 200; this should redirect
    // bar to '789' but preserve the new foo 200.
    expectedUrl = '/200/789';
    transitionTo(router, 'fooIndex', '200');

    assert.equal(
      handlers.foo.modelCount,
      4,
      'redirect in foo#afterModel should re-run foo#model'
    );

    assert.deepEqual(handlers.foo.context, { id: '200' });
    assert.deepEqual(
      handlers.bar.context,
      { id: '789' },
      'bar should have redirected to bar 789'
    );
  });

  test("Starting on '/' root index, using redirect", function(assert) {
    handlers.foo.redirect = handlers.foo.afterModel;
    delete handlers.foo.afterModel;

    transitionTo(router, '/');

    // Should call model for foo and bar
    expectedUrl = '/123/789';
    transitionTo(router, 'barIndex', '123', '456');

    assert.equal(
      handlers.foo.modelCount,
      1,
      'redirect in foo#redirect should NOT run foo#model (since validation succeeded)'
    );

    assert.deepEqual(handlers.foo.context, { id: '123' });
    assert.deepEqual(
      handlers.bar.context,
      { id: '789' },
      'bar should have redirected to bar 789'
    );

    // Try setting foo's context to 200; this should redirect
    // bar to '789' but preserve the new foo 200.
    expectedUrl = '/200/789';
    transitionTo(router, 'fooIndex', '200');

    assert.equal(
      handlers.foo.modelCount,
      2,
      'redirect in foo#redirect should NOT foo#model'
    );

    assert.deepEqual(handlers.foo.context, { id: '200' });
    assert.deepEqual(
      handlers.bar.context,
      { id: '789' },
      'bar should have redirected to bar 789'
    );
  });

  test('Starting on non root index', function(assert) {
    transitionTo(router, '/123/456');
    assert.deepEqual(handlers.foo.context, { id: '123' });
    assert.deepEqual(
      handlers.bar.context,
      { id: '789' },
      'bar should have redirected to bar 789'
    );

    // Try setting foo's context to 200; this should redirect
    // bar to '789' but preserve the new foo 200.
    expectedUrl = '/200/789';

    transitionTo(router, 'fooIndex', '200');

    assert.deepEqual(handlers.foo.context, { id: '200' });
    assert.deepEqual(
      handlers.bar.context,
      { id: '789' },
      'bar should have redirected to bar 789'
    );
  });

  /* TODO revisit
test("A failed handler's setup shouldn't prevent future transitions", function(assert) {
  assert.expect(2);

  enableErrorHandlingDeferredActionQueue();

  map(assert, function(match) {
    match("/parent").to('parent', function(match) {
      match("/articles").to('articles');
      match("/login").to('login');
    });
  });

  var error = new Error("blorg");

  handlers = {
    articles: {
      setup: function() {
        assert.ok(true, "articles setup was entered");
        throw error;
      },
      events: {
        error: function() {
          assert.ok(true, "error handled in articles");
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
*/

  test("beforeModel shouldn't be refired with incorrect params during redirect", function(assert) {
    // Source: https://github.com/emberjs/ember.js/issues/3407

    assert.expect(3);

    map(assert, function(match) {
      match('/').to('index');
      match('/people/:id').to('people', function(match) {
        match('/').to('peopleIndex');
        match('/home').to('peopleHome');
      });
    });

    var peopleModels = [null, {}, {}];
    var peopleBeforeModelCalled = false;

    handlers = {
      people: {
        beforeModel: function() {
          assert.ok(
            !peopleBeforeModelCalled,
            'people#beforeModel should only be called once'
          );
          peopleBeforeModelCalled = true;
        },
        model: function(params) {
          assert.ok(params.id, 'people#model called');
          return peopleModels[params.id];
        },
      },
      peopleIndex: {
        afterModel: function() {
          router.transitionTo('peopleHome');
        },
      },
      peopleHome: {
        setup: function() {
          assert.ok(true, 'I was entered');
        },
      },
    };

    transitionTo(router, '/');
    transitionTo(router, 'peopleIndex', '1');
  });

  module('URL-less routes (' + scenario.name + ')', {
    setup: function(assert) {
      handlers = {};
      expectedUrl = null;

      map(assert, function(match) {
        match('/index').to('index');
        match('/admin').to('admin', function(match) {
          match('/posts').to('adminPosts');
          match('/articles').to('adminArticles');
        });
      });
    },
  });

  test("Transitioning into a route marked as inaccessibleByURL doesn't update the URL", function(assert) {
    assert.expect(1);

    handlers = {
      adminPosts: {
        inaccessibleByURL: true,
      },
    };

    router
      .handleURL('/index')
      .then(function() {
        url = '/index';
        return router.transitionTo('adminPosts');
      })
      .then(function() {
        assert.equal(url, '/index');
      });
  });

  test("Transitioning into a route with a parent route marked as inaccessibleByURL doesn't update the URL", function(assert) {
    assert.expect(2);

    handlers = {
      admin: {
        inaccessibleByURL: true,
      },
    };

    transitionTo(router, '/index');
    url = '/index';
    transitionTo(router, 'adminPosts');
    assert.equal(url, '/index');
    transitionTo(router, 'adminArticles');
    assert.equal(url, '/index');
  });

  test('Handling a URL on a route marked as inaccessible behaves like a failed url match', function(assert) {
    assert.expect(1);

    handlers = {
      admin: {
        inaccessibleByURL: true,
      },
    };

    router
      .handleURL('/index')
      .then(function() {
        return router.handleURL('/admin/posts');
      })
      .then(shouldNotHappen(assert), function(e) {
        assert.equal(
          e.name,
          'UnrecognizedURLError',
          'error.name is UnrecognizedURLError'
        );
      });
  });

  module('Intermediate transitions (' + scenario.name + ')', {
    setup: function(assert) {
      handlers = {};
      expectedUrl = null;

      map(assert, function(match) {
        match('/').to('application', function(match) {
          //match("/").to("index");
          match('/foo').to('foo');
          match('/loading').to('loading');
        });
      });
    },
  });

  test("intermediateTransitionTo() forces an immediate intermediate transition that doesn't cancel currently active async transitions", function(assert) {
    assert.expect(11);

    var counter = 1,
      willResolves,
      appModel = {},
      fooModel = {};

    function counterAt(expectedValue, description) {
      assert.equal(
        counter,
        expectedValue,
        'Step ' + expectedValue + ': ' + description
      );
      counter++;
    }

    handlers = {
      application: {
        model: function() {
          return appModel;
        },
        setup: function(obj) {
          counterAt(1, 'application#setup');
          assert.equal(
            obj,
            appModel,
            'application#setup is passed the return value from model'
          );
        },
        events: {
          willResolveModel: function(transition, handler) {
            assert.equal(
              willResolves.shift(),
              handler,
              'willResolveModel event fired and passed expanded handler'
            );
          },
        },
      },
      foo: {
        model: function() {
          router.intermediateTransitionTo('loading');
          counterAt(3, 'intermediate transition finished within foo#model');

          return new Promise(function(resolve) {
            counterAt(4, "foo's model promise resolves");
            resolve(fooModel);
          });
        },
        setup: function(obj) {
          counterAt(6, 'foo#setup');
          assert.equal(
            obj,
            fooModel,
            'foo#setup is passed the resolve model promise'
          );
        },
      },
      loading: {
        model: function() {
          assert.ok(false, "intermediate transitions don't call model hooks");
        },
        setup: function() {
          counterAt(2, 'loading#setup');
        },
        exit: function() {
          counterAt(5, 'loading state exited');
        },
      },
    };

    willResolves = [handlers.application, handlers.foo];

    transitionTo(router, '/foo');

    counterAt(7, 'original transition promise resolves');
  });

  test('Calling transitionTo during initial transition in validation hook should use replaceURL', function(assert) {
    assert.expect(4);
    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
    });

    var fooModelCount = 0,
      barModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.ok(
        false,
        'The url was not correctly replaced on initial transition'
      );
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      assert.ok(true, 'The url was replaced correctly on initial transition');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.transitionTo('/bar');
      },
    };

    var barHandler = {
      model: function() {
        barModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
    };

    transitionTo(router, '/foo');

    assert.equal(url, '/bar');
    assert.equal(fooModelCount, 1);
    assert.equal(barModelCount, 1);
  });

  test('Calling transitionTo during initial transition in validation hook with multiple redirects should use replaceURL', function(assert) {
    assert.expect(5);
    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
      match('/baz').to('baz');
    });

    var fooModelCount = 0,
      barModelCount = 0,
      bazModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.ok(
        false,
        'The url was not correctly replaced on initial transition'
      );
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      assert.ok(true, 'The url was replaced correctly on initial transition');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.transitionTo('/bar');
      },
    };

    var barHandler = {
      model: function() {
        barModelCount++;
        router.transitionTo('/baz');
      },
    };

    var bazHandler = {
      model: function() {
        bazModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
      baz: bazHandler,
    };

    transitionTo(router, '/foo');

    assert.equal(url, '/baz');
    assert.equal(fooModelCount, 1);
    assert.equal(barModelCount, 1);
    assert.equal(bazModelCount, 1);
  });

  test('Calling transitionTo after initial transition in validation hook should use updateUrl', function(assert) {
    assert.expect(8);

    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
    });

    var fooModelCount = 0,
      barModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.ok(true, 'updateURL should be used');
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      assert.ok(false, 'replaceURL should not be used');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.transitionTo('/bar');
      },
    };

    var barHandler = {
      model: function() {
        barModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
    };

    transitionTo(router, '/bar');

    assert.equal(url, '/bar');
    assert.equal(barModelCount, 1, 'Bar model should be called once');
    assert.equal(fooModelCount, 0, 'Foo model should not be called');

    transitionTo(router, '/foo');

    assert.equal(url, '/bar');
    assert.equal(barModelCount, 2, 'Bar model should be called twice');
    assert.equal(fooModelCount, 1, 'Foo model should be called once');
  });

  test('Calling transitionTo after initial transition in validation hook with multiple redirects should use updateUrl', function(assert) {
    assert.expect(10);

    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
      match('/baz').to('baz');
    });

    var fooModelCount = 0,
      barModelCount = 0,
      bazModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.ok(true, 'updateURL should be used');
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      assert.ok(false, 'replaceURL should not be used');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.transitionTo('/bar');
      },
    };

    var barHandler = {
      model: function() {
        barModelCount++;
        router.transitionTo('/baz');
      },
    };

    var bazHandler = {
      model: function() {
        bazModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
      baz: bazHandler,
    };

    transitionTo(router, '/baz');

    assert.equal(url, '/baz');
    assert.equal(bazModelCount, 1, 'Baz model should be called once');
    assert.equal(fooModelCount, 0, 'Foo model should not be called');
    assert.equal(barModelCount, 0, 'Bar model should not be called');

    transitionTo(router, '/foo');

    assert.equal(url, '/baz');
    assert.equal(bazModelCount, 2, 'Baz model should be called twice');
    assert.equal(fooModelCount, 1, 'Foo model should be called once');
    assert.equal(barModelCount, 1, 'Bar model should be called once');
  });

  test('Calling replaceWith during initial transition in validation hook should use replaceURL', function(assert) {
    assert.expect(4);
    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
    });

    var fooModelCount = 0,
      barModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.ok(
        false,
        'The url was not correctly replaced on initial transition'
      );
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      assert.ok(true, 'The url was replaced correctly on initial transition');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.replaceWith('/bar');
      },
    };

    var barHandler = {
      model: function() {
        barModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
    };

    transitionTo(router, '/foo');

    assert.equal(url, '/bar');
    assert.equal(fooModelCount, 1);
    assert.equal(barModelCount, 1);
  });

  test('Calling replaceWith during initial transition in validation hook with multiple redirects should use replaceURL', function(assert) {
    assert.expect(5);
    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
      match('/baz').to('baz');
    });

    var fooModelCount = 0,
      barModelCount = 0,
      bazModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.ok(
        false,
        'The url was not correctly replaced on initial transition'
      );
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      assert.ok(true, 'The url was replaced correctly on initial transition');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.replaceWith('/bar');
      },
    };

    var barHandler = {
      model: function() {
        barModelCount++;
        router.replaceWith('/baz');
      },
    };

    var bazHandler = {
      model: function() {
        bazModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
      baz: bazHandler,
    };

    transitionTo(router, '/foo');

    assert.equal(url, '/baz');
    assert.equal(fooModelCount, 1, 'should call foo model once');
    assert.equal(barModelCount, 1, 'should call bar model once');
    assert.equal(bazModelCount, 1, 'should call baz model once');
  });

  test('Calling replaceWith after initial transition in validation hook should use updateUrl', function(assert) {
    assert.expect(8);

    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
    });

    var fooModelCount = 0,
      barModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.ok(true, 'updateURL should be used');
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      assert.ok(false, 'replaceURL should not be used');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.replaceWith('/bar');
      },
    };
    var barHandler = {
      model: function() {
        barModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
    };

    transitionTo(router, '/bar');

    assert.equal(url, '/bar');
    assert.equal(barModelCount, 1, 'Bar model should be called once');
    assert.equal(fooModelCount, 0, 'Foo model should not be called');

    transitionTo(router, '/foo');

    assert.equal(url, '/bar');
    assert.equal(barModelCount, 2, 'Bar model should be called twice');
    assert.equal(fooModelCount, 1, 'Foo model should be called once');
  });

  test('Calling replaceWith after initial transition in validation hook with multiple redirects should use updateUrl', function(assert) {
    assert.expect(10);

    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
      match('/baz').to('baz');
    });

    var fooModelCount = 0,
      barModelCount = 0,
      bazModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.ok(true, 'updateURL should be used');
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      assert.ok(false, 'replaceURL should not be used');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.replaceWith('/bar');
      },
    };

    var barHandler = {
      model: function() {
        barModelCount++;
        router.replaceWith('/baz');
      },
    };

    var bazHandler = {
      model: function() {
        bazModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
      baz: bazHandler,
    };

    transitionTo(router, '/baz');

    assert.equal(url, '/baz');
    assert.equal(bazModelCount, 1, 'Bar model should be called once');
    assert.equal(fooModelCount, 0, 'Foo model should not be called');
    assert.equal(barModelCount, 0, 'Baz model should not be called');

    transitionTo(router, '/foo');

    assert.equal(url, '/baz');
    assert.equal(bazModelCount, 2, 'Baz model should be called twice');
    assert.equal(fooModelCount, 1, 'Foo model should be called once');
    assert.equal(barModelCount, 1, 'Bar model should be called once');
  });

  test('Calling replaceWith after initial replace in validation hook with multiple redirects should use replaceUrl', function(assert) {
    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
      match('/baz').to('baz');
      match('/qux').to('qux');
    });

    var fooModelCount = 0,
      barModelCount = 0,
      bazModelCount = 0,
      history = [];

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      history.push(url);
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      if (history.length === 0) {
        assert.ok(false, 'should not replace on initial');
      }
      history[history.length - 1] = url;
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.replaceWith('/bar');
      },
    };

    var barHandler = {
      model: function() {
        barModelCount++;
        router.replaceWith('/baz');
      },
    };

    var bazHandler = {
      model: function() {
        bazModelCount++;
      },
    };

    var quxHandler = {
      model: function() {},
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
      baz: bazHandler,
      qux: quxHandler,
    };

    transitionTo(router, '/qux');

    assert.equal(history.length, 1, 'only one history item');
    assert.equal(history[0], '/qux', 'history item is /qux');

    replaceWith(router, '/foo');

    assert.equal(
      history.length,
      1,
      'still only one history item, replaced the previous'
    );
    assert.equal(history[0], '/baz', 'history item is /foo');
    assert.equal(fooModelCount, 1, 'Foo model should be called once');
    assert.equal(barModelCount, 1, 'Bar model should be called once');
    assert.equal(bazModelCount, 1, 'Baz model should be called once');
  });

  test('Mixing multiple types of redirect during initial transition should work', function(assert) {
    assert.expect(10);

    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
      match('/baz').to('baz');
    });

    var fooModelCount = 0,
      barModelCount = 0,
      bazModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.ok(true, 'updateURL should be used');
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      assert.ok(false, 'replaceURL should not be used');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.replaceWith('/bar');
      },
    };

    var barHandler = {
      model: function() {
        barModelCount++;
        router.transitionTo('/baz');
      },
    };

    var bazHandler = {
      model: function() {
        bazModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
      baz: bazHandler,
    };

    transitionTo(router, '/baz');

    assert.equal(url, '/baz');
    assert.equal(bazModelCount, 1, 'Bar model should be called once');
    assert.equal(fooModelCount, 0, 'Foo model should not be called');
    assert.equal(barModelCount, 0, 'Baz model should not be called');

    transitionTo(router, '/foo');

    assert.equal(url, '/baz');
    assert.equal(bazModelCount, 2, 'Baz model should be called twice');
    assert.equal(fooModelCount, 1, 'Foo model should be called once');
    assert.equal(barModelCount, 1, 'Bar model should be called once');
  });

  test('Mixing multiple types of redirects after initial transition should work', function(assert) {
    assert.expect(12);

    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
      match('/baz').to('baz');
    });

    var fooModelCount = 0,
      barModelCount = 0,
      bazModelCount = 0,
      updateUrlCount = 0,
      replaceUrlCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      updateUrlCount++;
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      replaceUrlCount++;
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
        router.replaceWith('/bar');
      },
    };

    var barHandler = {
      model: function() {
        barModelCount++;
        router.transitionTo('/baz');
      },
    };

    var bazHandler = {
      model: function() {
        bazModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
      baz: bazHandler,
    };

    transitionTo(router, '/baz');
    // actually replaceURL probably makes more sense here, but it's an initial
    // transition to a route that the page loaded on, so it's a no-op and doesn't
    // cause a problem
    assert.equal(replaceUrlCount, 0, 'replaceURL should not be used');
    assert.equal(
      updateUrlCount,
      1,
      'updateURL should be used for initial transition'
    );
    assert.equal(url, '/baz');
    assert.equal(bazModelCount, 1, 'Baz model should be called once');
    assert.equal(fooModelCount, 0, 'Foo model should not be called');
    assert.equal(barModelCount, 0, 'Bar model should not be called');

    transitionTo(router, '/foo');

    assert.equal(replaceUrlCount, 0, 'replaceURL should not be used');
    assert.equal(
      updateUrlCount,
      2,
      'updateURL should be used for subsequent transition'
    );
    assert.equal(url, '/baz');
    assert.equal(bazModelCount, 2, 'Baz model should be called twice');
    assert.equal(fooModelCount, 1, 'Foo model should be called once');
    assert.equal(barModelCount, 1, 'Bar model should be called once');
  });

  test('Calling replaceWith after initial transition outside validation hook should use replaceURL', function(assert) {
    assert.expect(7);

    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
    });

    var fooModelCount = 0,
      barModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.equal(updateUrl, '/foo', 'incorrect url for updateURL');
    };

    router.replaceURL = function(replaceUrl) {
      url = replaceUrl;
      assert.equal(replaceUrl, '/bar', 'incorrect url for replaceURL');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
      },
    };
    var barHandler = {
      model: function() {
        barModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
    };

    transitionTo(router, '/foo');

    assert.equal(url, '/foo', 'failed initial transition');
    assert.equal(fooModelCount, 1, 'Foo model should be called once');
    assert.equal(barModelCount, 0, 'Bar model should not be called');

    router.replaceWith('/bar');
    flushBackburner();

    assert.equal(fooModelCount, 1, 'Foo model should be called once');
    assert.equal(barModelCount, 1, 'Bar model should be called once');
  });

  test('Calling transitionTo after initial transition outside validation hook should use updateUrl', function(assert) {
    assert.expect(7);

    map(assert, function(match) {
      match('/foo').to('foo');
      match('/bar').to('bar');
    });

    var fooModelCount = 0,
      barModelCount = 0;

    router.updateURL = function(updateUrl) {
      url = updateUrl;
      assert.ok(true, 'updateURL is used');
    };

    router.replaceURL = function(replaceURL) {
      url = replaceURL;
      assert.ok(false, 'replaceURL should not be used');
    };

    var fooHandler = {
      model: function() {
        fooModelCount++;
      },
    };
    var barHandler = {
      model: function() {
        barModelCount++;
      },
    };

    handlers = {
      foo: fooHandler,
      bar: barHandler,
    };

    transitionTo(router, '/foo');

    assert.equal(url, '/foo', 'failed initial transition');
    assert.equal(fooModelCount, 1, 'Foo model should be called once');
    assert.equal(barModelCount, 0, 'Bar model should not be called');

    transitionTo(router, '/bar');

    assert.equal(fooModelCount, 1, 'Foo model should be called once');
    assert.equal(barModelCount, 1, 'Bar model should be called once');
  });

  test('transitioning to the same route with different context should not reenter the route', function(assert) {
    map(assert, function(match) {
      match('/project/:project_id').to('project');
    });

    var projectEnterCount = 0;
    var projectSetupCount = 0;
    var projectHandler = {
      model: function(params) {
        delete params.queryParams;
        return params;
      },
      enter: function() {
        projectEnterCount++;
      },
      setup: function() {
        projectSetupCount++;
      },
    };

    handlers = {
      project: projectHandler,
    };

    transitionTo(router, '/project/1');
    assert.equal(
      projectEnterCount,
      1,
      'project handler should have been entered once'
    );
    assert.equal(
      projectSetupCount,
      1,
      'project handler should have been setup once'
    );

    transitionTo(router, '/project/2');
    assert.equal(
      projectEnterCount,
      1,
      'project handler should still have been entered only once'
    );
    assert.equal(
      projectSetupCount,
      2,
      'project handler should have been setup twice'
    );
  });

  test('synchronous transition errors can be detected synchronously', function(assert) {
    map(assert, function(match) {
      match('/').to('root');
    });

    router.getHandler = function() {
      throw new Error('boom!');
    };

    assert.equal(transitionTo(router, '/').error.message, 'boom!');
  });
});
