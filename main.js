import { Meteor } from "meteor/meteor";
import { check } from "meteor/check";
import { Mongo } from "meteor/mongo";

import { Log } from "meteor/convexset:log";
import { AccessCheck } from "meteor/convexset:access-check";

console.log("************************************************************")
console.log("* Server Started at", new Date());
console.log("************************************************************")

/* global _Log: true */
/* global _check: true */
Meteor.startup(function() {
	if (Meteor.isDevelopment) {
		_Log = Log;
		_check = check;
		AccessCheck.DEBUG_MODE = true;
	}
});

Log.registerException("bad-number", params => `Bad number: ${params.someNumber}`);
AccessCheck.registerCheck({
	checkName: "some-number-at-least-5",
	checkFunction: function({someNumber}) {
		return someNumber >= 5;
	},
	failureCallback: function(params) {
		Log.throwException("bad-number", params);
	}
});

AccessCheck.registerCheck({
	checkName: "some-number-at-least-3",
	checkFunction: function({someNumber}) {
		return someNumber >= 3;
	},
	failureCallback: function(params) {
		Log.throwException("bad-number", params);
	}
});

Log.registerException("some-check-not-run", "Some check not run.");
AccessCheck.registerCheck({
	checkName: "some-check",
	checkFunction: function() {
		console.log("[check|some-check]");
		return true;
	},
	failureCallback: function() {
		Log.throwException("some-check-not-run");
	}
});

AccessCheck.makeMethod({
	name: "some-method",
	body: function({
		someNumber
	}) {
		console.log(`[method] someNumber: ${someNumber}`);

		Meteor.call("other-method", {someNumber: someNumber - 1});
		AccessCheck.milestoneAssertion("some-milestone");

		otherCollection.insert({step: 2, someNumber: someNumber, ts: new Date()});

		return someNumber;
	},
	schema: {
		someNumber: {
			type: Number
		}
	},
	accessChecks: ["some-number-at-least-5"],
	requiredChecksBeforeDBWrite: ["some-check"],
	requiredChecksBeforeMilestone: {
		"some-milestone": ["some-check"]
	}
});

Meteor.methods({
	"other-method": function() {
		AccessCheck.executeCheck({checkName: "some-check"})
	}
})

/* global thingCollection: true */
thingCollection = new Mongo.Collection("things");
otherCollection = new Mongo.Collection("sub-counts");
if (Meteor.isServer) {
	Meteor.startup(function() {
		thingCollection.remove({});
		_.times(2, function(idx) {
			thingCollection.insert({
				idx: idx
			});
		});
	});
	AccessCheck.makePublication({
		name: "some-pub",
		body: function({
			someNumber
		}) {
			console.log(`[pub] someNumber: ${someNumber}`);
			otherCollection.insert({someNumber: someNumber, ts: new Date()});
			AccessCheck.executeCheck({checkName: "some-check"})
			var cursor = thingCollection.find();
			return cursor;
		},
		schema: {
			someNumber: {
				type: Number
			}
		},
		accessChecks: ["some-number-at-least-5"],
		requiredChecksBeforeDBRead: ["some-check"]
	});	

	AccessCheck.makePublication({
		name: "some-pub-that-fails",
		body: function({
			someNumber
		}) {
			console.log(`[pub] someNumber: ${someNumber}`);
			otherCollection.insert({someNumber: someNumber, ts: new Date()});
			var cursor = thingCollection.find();
			return cursor;
		},
		schema: {
			someNumber: {
				type: Number
			}
		},
		accessChecks: ["some-number-at-least-5"],
		requiredChecksBeforeDBRead: ["some-check"]
	});	

} else {
	import { Tracker } from 'meteor/tracker';
	Meteor.startup(function() {
		Tracker.autorun(function () {
			console.log("------------");
			console.log("Data:");
			thingCollection.find().forEach((x, idx) => console.log(`[${idx}]`, x));
			console.log("------------");
		});

		var subCallbacks = {
			onReady: () => console.log(`[sub|cb|onReady]`),
			onError: p => console.log(`[sub|cb|onError] ${p}`),
			onStop: p => console.log(`[sub|cb|onStop] ${p}`)
		};

		/* global failingSub1: true */
		/* global failingSub2: true */
		/* global regularSub: true */
		setTimeout(function() {
			console.log(`Calling: Meteor.subscribe("some-pub", {someNumber: 2}, subCallbacks)`);
			failingSub1 = Meteor.subscribe("some-pub", {someNumber: 2}, subCallbacks);
		}, 5000);

		setTimeout(function() {
			console.log(`Calling: Meteor.subscribe("some-pub", {someNumber: 6}, subCallbacks)`);
			regularSub = Meteor.subscribe("some-pub", {someNumber: 6}, subCallbacks);
		}, 10000);

		setTimeout(function() {
			console.log(`Calling: Meteor.subscribe("some-pub-that-fails", {someNumber: 7}, subCallbacks)`);
			failingSub2 = Meteor.subscribe("some-pub-that-fails", {someNumber: 7}, subCallbacks);
		}, 7500);

	});
}


if (Meteor.isClient) {
	setTimeout(function() {
		console.log(`Calling: Meteor.call("some-method", {someNumber: 7}, (err, res) => console.log(err, res))`);
		Meteor.call("some-method", {someNumber: 7}, (err, res) => console.log("Method return:", err, res));
	}, 1000);

	setTimeout(function() {
		console.log(`Calling: Meteor.call("some-method", {someNumber: 1}, (err, res) => console.log(err, res))`);
		Meteor.call("some-method", {someNumber: 1}, (err, res) => console.log("Method return:", err, res));
	}, 3000);
}
