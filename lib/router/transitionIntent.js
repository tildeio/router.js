import { merge } from './utils';

function TransitionIntent(props) {
  if (props) {
    merge(this, props);
  }
  this.data = this.data || {};
}

TransitionIntent.prototype.applyToState = function(oldState) {
  // Default TransitionIntent is a no-op.
  return oldState;
};



export { TransitionIntent };

/*


Ember.Router = Ember.StateManager.extend({
});



link-to 'foo' fooObject
transitionTo('foo', fooObject)

this.route('users', '/users/:user_id');

url-based: handleUrl('/users/123');
- URL has already changed at this point
- call RouteRecognizer#recognize('/users/123')
  - returns params and handler names for the provided URL
  - recogHandlers
  - [{handler: 'application', params: {}}, { handler: 'users', params: { user_id: '123' } }]

named: transitionTo('users', User.find(123));
- Updates URL at the end of the transition (once all promises have resolved)
- RouteRecognizer.generate('users', resolvedUserObject)
  - "/users/123"
  - transitionTo('users', new RSVP.Promise(someResolvingFn));
  - {{link-to 'users' 123}}
  - {{link-to 'users' '123'}}
    - Route#model({ user_id: '123' })
    - Transition.eagerURLUpdate()



- call RouteRecognizer#handlersFor('users')
  - return similar form to recogHandlers
  - [{handler: 'application', names: []}, { handler: 'users', names: ['user_id'] }]







HandlerInfo: router.js


*/

