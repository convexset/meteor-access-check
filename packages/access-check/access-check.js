////////////////////////////////////////////////////////////////////////////////
// Boiler Plate
////////////////////////////////////////////////////////////////////////////////
import { checkNpmVersions } from 'meteor/tmeasday:check-npm-versions';
checkNpmVersions({  
	'package-utils': '^0.2.1',
	'underscore': '^1.8.3'
});  // package name can be omitted
const PackageUtilities = require('package-utils');
const _ = require('underscore');

import { Meteor } from 'meteor/meteor';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import { check } from 'meteor/check';
import { SimpleSchema } from 'meteor/aldeed:simple-schema';

////////////////////////////////////////////////////////////////////////////////
// The Main Event
////////////////////////////////////////////////////////////////////////////////

const AccessCheck = (function() {
	var _acConstr = function AccessCheck() {};
	var _ac = new _acConstr();

	////////////////////////////////////////////////////////////////////////////
	// Const
	////////////////////////////////////////////////////////////////////////////
	const EVERYWHERE = "everywhere";
	const CLIENT_ONLY = "client-only";
	const SERVER_ONLY = "server-only";

	PackageUtilities.addImmutablePropertyValue(_ac, "EVERYWHERE", EVERYWHERE);
	PackageUtilities.addImmutablePropertyValue(_ac, "CLIENT_ONLY", CLIENT_ONLY);
	PackageUtilities.addImmutablePropertyValue(_ac, "SERVER_ONLY", SERVER_ONLY);

	////////////////////////////////////////////////////////////////////////////
	// Checkers
	////////////////////////////////////////////////////////////////////////////
	var _checkFunctions = {};
	PackageUtilities.addImmutablePropertyFunction(_ac, "registerCheck",
		function registerCheck({
			checkName, checkFunction,
			defaultSite = EVERYWHERE, failureCallback = function() {}
		}) {
			if (typeof checkName !== "string") {
				throw new Meteor.Error("invalid-check-name");
			}
			if (!_.isFunction(checkFunction)) {
				throw new Meteor.Error("invalid-check-function");
			}
			if (!_.isFunction(failureCallback)) {
				throw new Meteor.Error("invalid-failure-callback-function");
			}
			if (!!_checkFunctions[checkName]) {
				console.warn(`Check name ${checkName} already exists. Overwriting...`);
			}
			_checkFunctions[checkName] = {
				checkFunction: checkFunction,
				defaultSite: defaultSite,
				failureCallback: failureCallback
			};
		}
	);


	////////////////////////////////////////////////////////////////////////////
	// Running Checks
	////////////////////////////////////////////////////////////////////////////
	PackageUtilities.addImmutablePropertyFunction(_ac, "executeCheck",
		function executeCheck({
			checkName, where, params, executeFailureCallback = false
		}) {
			var context = this;
			var accessCheck = _checkFunctions[checkName];
			if (!accessCheck) {
				throw new Meteor.Error("no-such-access-check", checkName);
			}
			where = where || accessCheck.defaultSite;
			var runCheck = (where === AccessCheck.EVERYWHERE) || (Meteor.isClient && (where === AccessCheck.CLIENT_ONLY)) || (Meteor.isServer && (where === AccessCheck.CLIENT_ONLY));
			var outcome = {
				checkDone: runCheck
			};
			if (runCheck) {
				outcome.result = accessCheck.checkFunction.call(context, params);
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
	PackageUtilities.addImmutablePropertyFunction(_ac, "makeMethod",
		function makeMethod({
			name, body, schema = {}, accessChecks = [],
			limitPerInterval = -1, limitIntervalInSec = 60,
			additionalRateLimitingKeys = {
				connectionId: () => true
			}
		}) {
			Meteor.methods({
				[name]: function(params = {}) {
					check(params, new SimpleSchema(schema));
					var context = this;

					var allChecksPassed = true;

					accessChecks
						.map(o => typeof o === "string" ? {
							name: o
						} : o)
						.forEach(function runCheck({
							name, argumentMap = x => x, where
						}) {
							if (!allChecksPassed) {
								return;
							}
							var outcome
							try {
								outcome = _ac.executeCheck.call(context, {
									checkName: name,
									where: where,
									params: argumentMap(params),
									executeFailureCallback: true
								});
							} catch (e) {
								allChecksPassed = false;
							}
							if (outcome.checkDone && !outcome.result) {
								allChecksPassed = false;
							}
						});

					if (allChecksPassed) {
						return body.call(context, params);
					}
				}
			});
			if ((limitPerInterval > 0) && (limitIntervalInSec > 0)) {
				DDPRateLimiter(_.extend({}, additionalRateLimitingKeys, {
					type: "method",
					method: name
				}), limitPerInterval, limitIntervalInSec);
			}
		}
	);


	PackageUtilities.addImmutablePropertyFunction(_ac, "makePublication",
		function makePublication({
			name, body, schema = {}, accessChecks = []
		}) {
		Meteor.publish(name, function(params = {}) {
			check(params, new SimpleSchema(schema));
			var context = this;

			var allChecksPassed = true;

			try {
				accessChecks
					.map(o => typeof o === "string" ? {
						name: o
					} : o)
					.forEach(function runCheck({
						name, argumentMap = x => x, where
					}) {
						if (!allChecksPassed) {
							return;
						}
						var outcome;
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
						if (outcome.checkDone && !outcome.result) {
							allChecksPassed = false;
						}
					});
			} catch (e) {
				this.error(e);
			}

			if (allChecksPassed) {
				return body.call(context, params);
			} else {
				this.ready();
			}
		});
		}
	);


	////////////////////////////////////////////////////////////////////////////

	return _ac;
})();


////////////////////////////////////////////////////////////////////////////////
// Exports
////////////////////////////////////////////////////////////////////////////////

export {
	AccessCheck
};

////////////////////////////////////////////////////////////////////////////////