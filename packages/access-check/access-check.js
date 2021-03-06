////////////////////////////////////////////////////////////////////////////////
// Boiler Plate
////////////////////////////////////////////////////////////////////////////////
import { checkNpmVersions } from 'meteor/tmeasday:check-npm-versions';
checkNpmVersions({
	'package-utils': '^0.2.1',
	'underscore': '^1.8.3'
}); // package name can be omitted
const PackageUtilities = require('package-utils');
const _ = require('underscore');

import { Meteor } from 'meteor/meteor';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import { check } from 'meteor/check';
import { SimpleSchema } from 'meteor/aldeed:simple-schema';
import { FiberScope } from 'meteor/convexset:fiber-scope';
import { Mongo } from 'meteor/mongo';

/* eslint-disable no-console */

////////////////////////////////////////////////////////////////////////////////
// Fibers-based Tracking
////////////////////////////////////////////////////////////////////////////////

const ACCESS_CHECK_FIBER_STACK_NAME = 'convexset:access-check';
let Fiber = {};
if (Meteor.isServer) {
	Fiber = require('fibers');
	FiberScope._replaceMeteorTimerFunctions();
}

function isInFiber() {
	return !!Fiber.current;
}
let showACStackFrame = function() {};
if (Meteor.isServer) {
	showACStackFrame = function _showACStackFrame(s, ACFiberStack) {
		console.log(`[access-check|${s}] Current AC Stack Frame (${ACFiberStack.length} total):`);
		if (_.isObject(ACFiberStack[0])) {
			_.forEach(ACFiberStack[0], (v, n) => {
				console.log(`    - ${n}:`, v);
			});
		}
	};
}

////////////////////////////////////////////////////////////////////////////////
// The Main Event
////////////////////////////////////////////////////////////////////////////////

const AccessCheck = (function() {
	// eslint-disable-next-line no-shadow
	const _acConstr = function AccessCheck() {};
	const _ac = new _acConstr();
	_ac.DEBUG_MODE = false;
	_ac.DEBUG_MODE__SHOW_STACKTRACES = false;

	////////////////////////////////////////////////////////////////////////////
	// Const
	////////////////////////////////////////////////////////////////////////////
	const EVERYWHERE = 'everywhere';
	const CLIENT_ONLY = 'client-only';
	const SERVER_ONLY = 'server-only';

	PackageUtilities.addImmutablePropertyValue(_ac, 'EVERYWHERE', EVERYWHERE);
	PackageUtilities.addImmutablePropertyValue(_ac, 'CLIENT_ONLY', CLIENT_ONLY);
	PackageUtilities.addImmutablePropertyValue(_ac, 'SERVER_ONLY', SERVER_ONLY);

	////////////////////////////////////////////////////////////////////////////
	// Checkers
	////////////////////////////////////////////////////////////////////////////
	const _checkFunctions = {};
	PackageUtilities.addImmutablePropertyFunction(_ac, 'registerCheck',
		function registerCheck({
			checkName,
			checkFunction,
			defaultSite = EVERYWHERE,
			failureCallback = function() {},
			provisionallyAllowIfLoggingIn = false,
			provisionallyAllowIfSubsNotReady = false
		}) {
			if (typeof checkName !== 'string') {
				throw new Meteor.Error('invalid-check-name');
			}
			if (!_.isFunction(checkFunction)) {
				throw new Meteor.Error('invalid-check-function');
			}
			if (!_.isFunction(failureCallback)) {
				throw new Meteor.Error('invalid-failure-callback-function');
			}
			if (!!_checkFunctions[checkName]) {
				console.warn(`Check name ${checkName} already exists. Overwriting...`);
			}

			function _checkFunction() {
				// provisionally pass pending login completion
				if (provisionallyAllowIfLoggingIn && Meteor.isClient) {
					if (Meteor.loggingIn()) {
						return true;
					}
				}

				// provisionally pass pending data arrival on client
				if (provisionallyAllowIfSubsNotReady && Meteor.isClient) {
					if (!this.templateInstance.subscriptionsReady()) {
						return true;
					}
				}

				return checkFunction.apply(this, arguments);
			}

			_checkFunctions[checkName] = {
				checkFunction: _checkFunction,
				defaultSite: defaultSite,
				failureCallback: failureCallback
			};
		}
	);


	////////////////////////////////////////////////////////////////////////////
	// Running Checks
	////////////////////////////////////////////////////////////////////////////
	PackageUtilities.addImmutablePropertyFunction(_ac, 'executeCheck',
		function executeCheck({
			checkName,
			where,
			params,
			executeFailureCallback = false
		}) {
			const context = this;
			const accessCheck = _checkFunctions[checkName];
			if (!accessCheck) {
				throw new Meteor.Error('no-such-access-check', checkName);
			}
			where = where || accessCheck.defaultSite;
			const runCheck = (where === AccessCheck.EVERYWHERE) || (Meteor.isClient && (where === AccessCheck.CLIENT_ONLY)) || (Meteor.isServer && (where === AccessCheck.CLIENT_ONLY));
			const outcome = {
				checkDone: runCheck
			};
			if (runCheck) {
				outcome.result = accessCheck.checkFunction.call(context, params);

				if (isInFiber() && _.isArray(FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME])) {
					const ACFiberStack = FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME];
					if (_ac.DEBUG_MODE) {
						console.log(`[access-check|execute-check] Executed check: ${checkName}; Result:`, outcome.result);
						showACStackFrame('execute-check', ACFiberStack);
					}
					ACFiberStack.forEach(frame => {
						if (frame.checksAlreadyRun.indexOf(checkName) === -1) {
							frame.checksAlreadyRun.push(checkName);
						}
					});
				}

				if (!outcome.result && executeFailureCallback) {
					accessCheck.failureCallback.call(context, params);
				}
			}
			return outcome;
		}
	);

	////////////////////////////////////////////////////////////////////////////
	// Methods and Publications
	////////////////////////////////////////////////////////////////////////////
	PackageUtilities.addImmutablePropertyFunction(_ac, 'makeMethod',
		function makeMethod({
			name,
			body,
			schema = {},
			accessChecks = [],
			limitPerInterval = -1,
			limitIntervalInSec = 10,
			additionalRateLimitingKeys = ({
				connectionId: () => true
			}),
			requiredChecksBeforeDBRead = [],
			requiredChecksBeforeDBWrite = [],
			requiredChecksBeforeMilestone = {},
		}) {
			Meteor.methods({
				[name]: function(params = {}) {
					check(params, new SimpleSchema(schema));
					const context = _.extend({
						contextType: 'method',
					}, this);

					// Create new AC fiber stack frame (why? methods calling methods and all that)
					if (isInFiber()) {
						if (!FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME]) {
							FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME] = [];
						}
						const ACFiberStack = FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME];
						const newACFiberStackFrame = {
							type: 'method',
							name: name,
							checksAlreadyRun: [],
							accessChecks: accessChecks,
							requiredChecksBeforeDBWrite: requiredChecksBeforeDBWrite,
							requiredChecksBeforeDBRead: requiredChecksBeforeDBRead,
							requiredChecksBeforeMilestone: requiredChecksBeforeMilestone,
							milestonesChecked: [],
						};
						ACFiberStack.unshift(newACFiberStackFrame);
						if (_ac.DEBUG_MODE) {
							console.log(`[access-check|method] Created new Access Check Stack Frame`);
							showACStackFrame('method', ACFiberStack);
						}
					}

					let allChecksPassed = true;

					accessChecks
						.map(o => typeof o === 'string' ? {
							name: o
						} : o)
						.forEach(function runCheck({
							// eslint-disable-next-line no-shadow
							name,
							argumentMap = x => x,
							where
						}) {
							if (!allChecksPassed) {
								return;
							}
							const outcome = _ac.executeCheck.call(context, {
								checkName: name,
								where: where,
								params: argumentMap(params),
								executeFailureCallback: true
							});
							if (!outcome || (outcome.checkDone && !outcome.result)) {
								allChecksPassed = false;
							}
						});

					if (allChecksPassed) {
						const result = body.call(context, params);
						if (isInFiber() && _.isArray(FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME])) {
							const ACFiberStack = FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME];
							if (_ac.DEBUG_MODE) {
								console.log(`[access-check|method] Before Exit`);
								showACStackFrame('method', ACFiberStack);
							}
							const currentACFiberStackFrame = ACFiberStack.shift();
							_.forEach(currentACFiberStackFrame.requiredChecksBeforeMilestone, (checkList, milestoneName) => {
								if ((currentACFiberStackFrame.milestonesChecked.indexOf(milestoneName) === -1) && Meteor.isDevelopment) {
									console.warn(`[access-check] AccessCheck.milestoneAssertion('${milestoneName}') was not called in method ${name}.`);
								}
							});
						}
						return result;
					} else {
						return {
							ok: false,
							success: false,
							outcome: 'access-check-failed',
							note: 'If it is desired that this is registered as an error, such as with a Promise-ified method call, throw an error in the failureCallback.',
						};
					}
				}
			});

			// DDP Rate Limiter
			if ((limitPerInterval > 0) && (limitIntervalInSec > 0) && Meteor.isServer) {
				DDPRateLimiter.addRule(_.extend({}, additionalRateLimitingKeys, {
					type: 'method',
					name: name
				}), limitPerInterval, limitIntervalInSec * 1000);
			}
		}
	);


	if (Meteor.isServer) {
		PackageUtilities.addImmutablePropertyFunction(_ac, 'makePublication',
			function makePublication({
				name,
				body,
				schema = {},
				accessChecks = [],
				limitPerInterval = -1,
				limitIntervalInSec = 10,
				additionalRateLimitingKeys = ({
					connectionId: () => true
				}),
				requiredChecksBeforeDBRead = [],
				requiredChecksBeforeDBWrite = [],
				requiredChecksBeforeMilestone = {},
			}) {
				Meteor.publish(name, function(params = {}) {
					check(params, new SimpleSchema(schema));
					const context = _.extend({
						contextType: 'publication',
					}, this);

					// Create new AC fiber stack frame (why? methods calling methods and all that)
					if (isInFiber()) {
						if (!FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME]) {
							FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME] = [];
						}
						const ACFiberStack = FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME];
						const newACFiberStackFrame = {
							type: 'publication',
							name: name,
							checksAlreadyRun: [],
							accessChecks: accessChecks,
							requiredChecksBeforeDBWrite: requiredChecksBeforeDBWrite,
							requiredChecksBeforeDBRead: requiredChecksBeforeDBRead,
							requiredChecksBeforeMilestone: requiredChecksBeforeMilestone,
							milestonesChecked: [],
						};
						ACFiberStack.unshift(newACFiberStackFrame);
						if (_ac.DEBUG_MODE) {
							console.log(`[access-check|publication] Created new Access Check Stack Frame`);
							showACStackFrame('publication', ACFiberStack);
						}
					}

					let allChecksPassed = true;

					try {
						accessChecks
							.map(o => typeof o === 'string' ? {
								name: o
							} : o)
							.forEach(function runCheck({
								// eslint-disable-next-line no-shadow
								name,
								argumentMap = x => x,
								where
							}) {
								if (!allChecksPassed) {
									return;
								}
								let outcome;
								try {
									outcome = _ac.executeCheck.call(context, {
										checkName: name,
										where: where,
										params: argumentMap(params),
										executeFailureCallback: true
									});
								} catch (e) {
									// update allChecksPassed and toss it out
									// to update [pubContext].error
									allChecksPassed = false;
									throw e;
								}
								if (!outcome || (outcome.checkDone && !outcome.result)) {
									allChecksPassed = false;
								}
							});
					} catch (e) {
						this.error(e);
					}

					if (allChecksPassed) {
						const result = body.call(context, params);
						if (isInFiber() && _.isArray(FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME])) {
							const ACFiberStack = FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME];
							if (_ac.DEBUG_MODE) {
								console.log(`[access-check|publication] Before Exit`);
								showACStackFrame('publication', ACFiberStack);
							}
							const currentACFiberStackFrame = ACFiberStack.shift();
							_.forEach(currentACFiberStackFrame.requiredChecksBeforeMilestone, (checkList, milestoneName) => {
								if ((currentACFiberStackFrame.milestonesChecked.indexOf(milestoneName) === -1) && Meteor.isDevelopment) {
									console.warn(`[access-check] AccessCheck.milestoneAssertion('${milestoneName}') was not called in publication ${name}.`);
								}
							});
						}
						return result;
					} else {
						this.ready();
					}
				});

				// DDP Rate Limiter
				if ((limitPerInterval > 0) && (limitIntervalInSec > 0) && Meteor.isServer) {
					DDPRateLimiter.addRule(_.extend({}, additionalRateLimitingKeys, {
						type: 'subscription',
						name: name
					}), limitPerInterval, limitIntervalInSec * 1000);
				}
			}
		);
	}

	PackageUtilities.addImmutablePropertyFunction(_ac, 'milestoneAssertion',
		Meteor.isClient ? function nop() {} :
		function milestoneAssertion(milestoneName) {
			if (isInFiber() && _.isArray(FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME])) {
				const ACFiberStack = FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME];
				const currentACFiberStackFrame = ACFiberStack[0];
				if (!_.isArray(currentACFiberStackFrame.requiredChecksBeforeMilestone[milestoneName])) {
					throw new Meteor.Error('no-such-milestone', milestoneName);
				}
				if (AccessCheck.DEBUG_MODE) {
					console.log(`[access-check|milestone-assertion] ${milestoneName}`);
					if (AccessCheck.DEBUG_MODE__SHOW_STACKTRACES) {
						console.log(`[access-check|milestone-assertion] Location:\n`, getStackTrace());
					}
					showACStackFrame('milestone-assertion', ACFiberStack);
				}

				if (currentACFiberStackFrame.milestonesChecked.indexOf(milestoneName) === -1) {
					currentACFiberStackFrame.milestonesChecked.push(milestoneName);
				}

				currentACFiberStackFrame.requiredChecksBeforeMilestone[milestoneName].forEach(checkName => {
					if (currentACFiberStackFrame.checksAlreadyRun.indexOf(checkName) === -1) {
						if (AccessCheck.DEBUG_MODE) {
							console.log(`[access-check|milestone-assertion] ${milestoneName} failed with check ${checkName}.`);
						}
						throw new Meteor.Error('check-not-run-before-milestone', `Check not run before milestone ${milestoneName}: ${checkName}`);
					}
				});
			} else {
				throw new Meteor.Error('improper-usage-of-milestone-assertion', 'AccessCheck.milestoneAssertion should only be used in server-side methods and publications.');
			}
		}
	);

	PackageUtilities.addImmutablePropertyFunction(_ac, 'createInjectedCheck', function createInjectedCheck(checkName, site = EVERYWHERE) {
		let _check = () => true;
		let _failureCallback = () => true;

		_ac.registerCheck({
			checkName: checkName,
			checkFunction: function doCheck() {
				return _check.apply(this, arguments);
			},
			defaultSite: site,
			failureCallback: function doFailureCallback() {
				return _failureCallback.apply(this, arguments);
			}
		});

		return {
			setCheck: function setCheck(f) {
				_check = f;
			},
			setFailureCallback: function setFailureCallback(f) {
				_failureCallback = f;
			},
		};
	});

	PackageUtilities.addImmutablePropertyObject(_ac, 'COMMON_PATTERNS', {
		collectionHasItem: function collectionHasItem(collection, id, idKey = '_id') {
			return !!collection.findOne(_.object([
				[idKey, id]
			]));
		}
	});

	////////////////////////////////////////////////////////////////////////////

	return _ac;
})();


////////////////////////////////////////////////////////////////////////////////
// Ensure checks run before Mongo Writes / before Mongo Reads
////////////////////////////////////////////////////////////////////////////////

function getStackTrace() {
	const _stackTraceArr = (new Meteor.Error('not-an-exception')).stack.split('\n');
	_stackTraceArr.splice(0, 2);
	return _stackTraceArr.join('\n');
}

// Ensure checks run before Mongo Reads
['find', 'findOne'].forEach(fnName => {
	const originalMongoFunction = Mongo.Collection.prototype[fnName];
	Mongo.Collection.prototype[fnName] = function() {
		if (isInFiber()) {
			const ACFiberStack = FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME];
			if (_.isArray(ACFiberStack) && (ACFiberStack.length > 0)) {
				if (AccessCheck.DEBUG_MODE) {
					console.log(`[access-check|pre-mongo-read-check] Before Mongo.Collection#${fnName} on ${this._name}:`, _.toArray(arguments));
					if (AccessCheck.DEBUG_MODE__SHOW_STACKTRACES) {
						console.log(`[access-check|pre-mongo-read-check] Location:\n`, getStackTrace());
					}
					showACStackFrame('pre-mongo-read-check', ACFiberStack);
				}
				const currentACFiberStackFrame = ACFiberStack[0];
				currentACFiberStackFrame.requiredChecksBeforeDBRead.forEach(checkName => {
					if (currentACFiberStackFrame.checksAlreadyRun.indexOf(checkName) === -1) {
						if (AccessCheck.DEBUG_MODE) {
							console.log(`[access-check|pre-mongo-read-check] Failed at check ${checkName}.`);
						}
						throw new Meteor.Error('check-not-run-before-mongo-read', `Check not run before Mongo read operation: ${checkName}`);
					}
				});
			}
		}
		return originalMongoFunction.apply(this, _.toArray(arguments));
	};
});

// Ensure checks run before Mongo Writes
['insert', 'remove', 'update', 'upsert'].forEach(fnName => {
	const originalMongoFunction = Mongo.Collection.prototype[fnName];
	Mongo.Collection.prototype[fnName] = function() {
		if (isInFiber()) {
			const ACFiberStack = FiberScope.current[ACCESS_CHECK_FIBER_STACK_NAME];
			if (_.isArray(ACFiberStack) && (ACFiberStack.length > 0)) {
				if (AccessCheck.DEBUG_MODE) {
					console.log(`[access-check|pre-mongo-write-check] Before Mongo.Collection#${fnName} on ${this._name}:`, _.toArray(arguments));
					if (AccessCheck.DEBUG_MODE__SHOW_STACKTRACES) {
						console.log(`[access-check|pre-mongo-write-check] Location:\n`, getStackTrace());
					}
					showACStackFrame('pre-mongo-write-check', ACFiberStack);
				}
				const currentACFiberStackFrame = ACFiberStack[0];
				currentACFiberStackFrame.requiredChecksBeforeDBWrite.forEach(checkName => {
					if (currentACFiberStackFrame.checksAlreadyRun.indexOf(checkName) === -1) {
						if (AccessCheck.DEBUG_MODE) {
							console.log(`[access-check|pre-mongo-write-check] Failed at check ${checkName}.`);
						}
						throw new Meteor.Error('check-not-run-before-mongo-write', `Check not run before Mongo write operation: ${checkName}`);
					}
				});
			}
		}
		return originalMongoFunction.apply(this, _.toArray(arguments));
	};
});

////////////////////////////////////////////////////////////////////////////////
// Exports
////////////////////////////////////////////////////////////////////////////////

export {
	AccessCheck
};

////////////////////////////////////////////////////////////////////////////////
