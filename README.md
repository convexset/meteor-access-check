# AccessCheck

This package is about describing "access check" in a reusable fashion. (For example, a method manipulating a document might check if the logged in user "owns" the document.)

The package applies directly to Meteor Methods and publications where the same checks are typically re-used across multiple methods and publications. (Note: Differences in method signatures are handled "sensibly".)

One can even ensure that certain checks are run before Mongo read/write operations.

Additional integrations exist to support (non-reactive) access checks in routing and reactive access checks at the "template-level".

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
## Table of Contents

- [Usage:](#usage)
  - [Registering Access Checks](#registering-access-checks)
  - [Meteor Methods and Publications](#meteor-methods-and-publications)
  - [Executing Checks Directly](#executing-checks-directly)
- [Sample Data Contexts:](#sample-data-contexts)
  - [A Sample Data Context: Methods (on the Server)](#a-sample-data-context-methods-on-the-server)
  - [A Sample Data Context: Publications (on the Server)](#a-sample-data-context-publications-on-the-server)
- [Integrations](#integrations)
- [Milestone Checking](#milestone-checking)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


## Usage:

As is typical of post-Meteor 1.3 packages, begin with:
```javascript
import { AccessCheck } from "meteor/convexset:access-check";
```

### Registering Access Checks

Here are some examples:

Checking if a user is signed in:
```javascript
AccessCheck.registerCheck({
    checkName: "user-is-signed-in"
    checkFunction: function () {
        return !!this.userId;  // yes, the data context is available as if one
                               // were in a typical method or publication
    },
    defaultSite: AccessCheck.EVERYWHERE  // or AccessCheck.CLIENT_ONLY
                                         // or AccessCheck.SERVER_ONLY
});
```

Here is the recommended pattern for a check that might be run on both client and server, noting that the same information in the data contexts (see [examples below]((#sample-data-contexts)) may not be available:
```javascript
AccessCheck.registerCheck({
    checkName: "user-is-signed-in-or-called-server-side"
    checkFunction: function () {
        if (Meteor.isClient) {
            return !!this.userId;
        } else {
            return (this.connection === null) || (!!this.userId);
        }
    },
    defaultSite: AccessCheck.EVERYWHERE,
    failureCallback: function() {}
});
```

Using "reshaped" method/publication parameters (more on this immediately after this):
```javascript
AccessCheck.registerCheck({
    checkName: "user-owns-item"
    checkFunction: function (params) {
        var checkPassed = !!this.userId;
        if (checkPassed) {
            var item = ItemCollection.findOne({_id: params.itemId});
            var checkPassed = !!item && (this.userId === item.ownerId);
        }
        if (Meteor.isClient && !checkPassed) {
            // allow access provisionally if user is logging in or
            // if item sub is not yet ready

            // (ideally, the template will handle things when the reactive
            // dependencies get updated; for clarity, make sure that all
            // are registered by calling all of them)
            var isLoggingIn = Meteor.loggingIn();
            var itemSubNotReady = !ItemCollectionSub.ready();

            return isLoggingIn || itemSubNotReady;
        }
        return checkPassed;
    },
    defaultSite: AccessCheck.EVERYWHERE,
    failureCallback: function(params) {
        console.warn('Checked failed:', params);
    }
});
```

The contexts (i.e.: "`this`") that the above functions (`checkFunction` and `failureCallback`) are executed within will be the usual Meteor method and publication contexts.
(See [examples below]((#sample-data-contexts).)

Generally speaking, client-side failure callbacks should result in routing to a page which the current user is more likely to be authorized to be on. For example, access controls on a restricted route/template might boot an unauthorized user to the "main user dashboard" (MUD?) and access controls on the MUD might boot an unauthorized user to the login page (where probably no access controls apply except perhaps geographical ones by IP address, in which case...)

### Meteor Methods and Publications

Use `AccessCheck.makeMethod` and `AccessCheck.makePublication` for methods and publications respectively.
This supports methods and publications where method functions and publication functions take at most a single object argument and have the schema of the argument declared in [simple-schema format](https://atmospherejs.com/aldeed/simple-schema).
The syntax for methods and publications is identical.

```javascript
AccessCheck.makeMethod({
    name: "my-package/my-method";
    body: function({a1, itemId, a3}) {
        /* a lot of work, maybe... */
        AccessCheck.executeCheck({checkName: "system-is-not-locked"});
        ItemCollection.update({
            _id: itemId
        }, {
            $set: {
                something: a3 - a1  // whatever
            }
        });
    },
    schema: {
        a1: {type: Number},
        itemId: {type: String},  // maybe SimpleSchema.RegEx.Id
        a3: {type: Number},
    },
    accessChecks: [
        "user-is-signed-in",
        {
            name: "user-owns-item",
            argumentMap: function(params) {
                return {
                    itemId: params.itemId;
                }
            },  // actually unnecessary, defaults to x => x
            where: AccessCheck.EVERYWHERE   // defaults to undefined
                                            // in that case, what was declared
                                            // in AccessCheck.registerCheck
                                            // will be used
        }
    ],

    // within-body checks
    requiredChecksBeforeDBRead: [],
    requiredChecksBeforeDBWrite: ["system-is-not-locked"],
    requiredChecksBeforeMilestone: {
        "milestone-1": ["check-1", "check-2"]
    }

    // DDP Rate Limiter: See: http://docs.meteor.com/api/methods.html#ddpratelimiter
    limitPerInterval: 10,   // default: -1 (for no rate limiting)
    limitIntervalInSec: 60, // default: 10
    additionalRateLimitingKeys: {}, // default: { connectionId: () => true }
})
```


Arguments to `AccessCheck.makeMethod` and `AccessCheck.makePublication`:
 - `name`: the name of the method/publication
 - `body`: the body of the method/publication
 - `schema`: the schema for a single object argument to be passed in [simple-schema format](https://atmospherejs.com/aldeed/simple-schema); default: `{}`; note that methods/publications declared will take a single argument with a default of `{}`
 - `accessChecks`: an array of the names of checks (names as strings) or objects describing how to handle checks; default: []
   - `name`: name of the check
   - `argumentMap`: to address differences in method signatures, this parameter specifies the transformation of the method/publication argument to a form appropriate for the relevant check function (default: `x => x`)
   - `where`: where the check is executed, the default outlined in `AccessCheck.registerCheck` is used if not specified
 - `limitPerInterval`: if positive, does rate limiting to `limitPerInterval` calls per `limitIntervalInSec` seconds; (default: `-1`)
 - `limitIntervalInSec`: rate limiting interval; (default: `10`)
 - `additionalRateLimitingKeys`: See [this](http://docs.meteor.com/api/methods.html#ddpratelimiter) for more information; default: `{ connectionId: () => true }`
 - `requiredChecksBeforeDBRead`: An array of checks that should have been run (even via function calls within the body) before a Mongo read is performed; See [below](#milestone-checking) (default: `[]`),
 - `requiredChecksBeforeDBWrite`: An array of checks that should have been run (even via function calls within the body) before a Mongo write is performed; See [below](#milestone-checking) (default: `[]`),
 - `requiredChecksBeforeMilestone`: A dictionary of where the keys are milestone names (strings) and the values each arrays of checks that should have been run (even via function calls within the body) before the milestone; See [below](#milestone-checking) (default: `{}`),


### Executing Checks Directly

Simply do:
```javascript
AccessCheck.executeCheck({
    checkName: "some-check",
    where: AccessCheck.EVERYWHERE,
    params: {/* what to pass into check */},
    executeFailureCallback: true,  // default: false 
})
```

## Sample Data Contexts:

Examples of data contexts (Meteor methods and publications) are provided below for reference.

### A Sample Data Context: Methods (on the Server)

Here is a sample context (the `this` within a Meteor method is called):
```javascript
{
    contextType: "method",  // added by this package
    isSimulation: false,
    _unblock: [Function],
    _calledUnblock: false,
    userId: 'dwtnMSyxqxi32yGKC',
    _setUserId: [Function],
    connection: {
        id: 'iE7w8mcJ2RGHATCLi',
        close: [Function],
        onClose: [Function],
        clientAddress: '127.0.0.1',
        httpHeaders: {
            'x-forwarded-for': '127.0.0.1',
            host: 'localhost:7123',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.110 Safari/537.36',
            'accept-language': 'en-GB,en-US;q=0.8,en;q=0.6'
        }
    },
    randomSeed: null,
    randomStream: null
}
```

But then again, maybe one need only care about this subset:
```javascript
{
    contextType: "method",  // added by this package
    userId: 'dwtnMSyxqxi32yGKC',
    connection: {
        id: 'iE7w8mcJ2RGHATCLi',
        clientAddress: '127.0.0.1',
        httpHeaders: {
            'x-forwarded-for': '127.0.0.1',
            host: 'localhost:7123',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.110 Safari/537.36',
            'accept-language': 'en-GB,en-US;q=0.8,en;q=0.6'
        }
    }
}
```


### A Sample Data Context: Publications (on the Server)

Here is an example of a publication context (the `this` when a publication function is called during a subscription):
```javascript
{
    contextType: "publication",  // added by this package
    _session: { /* Don't Worry About This */ },
    connection: {
        id: 'ix35iGpY7TaX6p2Mr',
        close: [Function],
        onClose: [Function],
        clientAddress: '127.0.0.1',
        httpHeaders: {
            'x-forwarded-for': '127.0.0.1',
            host: 'localhost:7123',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.110 Safari/537.36',
            'accept-language': 'en-GB,en-US;q=0.8,en;q=0.6'
        }
    },
    _handler: [Function: publishLocks],
    _subscriptionId: 'FmqF9MdPaj9rEhgLN',
    _name: 'conn-id-locks',
    _params: [],
    _subscriptionHandle: 'NFmqF9MdPaj9rEhgLN',
    _deactivated: false,
    _stopCallbacks: [],
    _documents: {},
    _ready: false,
    userId: 'x9pnyfHjbK5c9u4Hz',
    _idFilter: {
        idStringify: [Function],
        idParse: [Function]
    }
}
```
... of course, this is perhaps the subset one should care about: 
```javascript
{
    contextType: "publication",  // added by this package
    connection: {
        id: 'ix35iGpY7TaX6p2Mr',
        httpHeaders: {
            'x-forwarded-for': '127.0.0.1',
            host: 'localhost:7123',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.110 Safari/537.36',
            'accept-language': 'en-GB,en-US;q=0.8,en;q=0.6'
        }
    },
    userId: 'x9pnyfHjbK5c9u4Hz'
}
```


## Integrations

The following packages tap `AccessCheck` for functionality:
 - non-reactive authentication during routing: [`convexset:flow-router-tree`](https://atmospherejs.com/convexset/flow-router-tree)
 - reactive authentication at the template level: [`convexset:template-level-auth`](https://atmospherejs.com/convexset/template-level-auth)


## Milestone Checking

Not all checks should be run before a Method/Publication body. Some should be run within. `AccessCheck` enables one to ensure certain checks are run at by the point of various milestones. Mongo reads and Mongo writes are included as certain milestones of general interest.

### Mongo Reads as a Milestone

This refers to the `find` and `findOne` operations.

See information on the `"requiredChecksBeforeDBRead"` key in setting up methods and publications [above](#meteor-methods-and-publications).

### Mongo Writes as a Milestone

This refers to the `insert`, `update`, `remove`, and `upsert` operations.

See information on the `"requiredChecksBeforeDBWrite"` key in setting up methods and publications [above](#meteor-methods-and-publications).

### Named Milestones

Named milestones are generic user-defined milestones.

The checks relating to a particular named milestone can be set using the `"requiredChecksBeforeMilestone"` key for setting up methods and publications. See [above](#meteor-methods-and-publications).

At any point `AccessCheck.milestoneAssertion(milestoneName)` can be used in methods and publications to assert that certain checks have been run before that point. (Checks are recorded even if they are invoked in function calls from within the method/publication function body.)

