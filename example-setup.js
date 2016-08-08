import { Meteor } from "meteor/meteor";
import { Mongo } from "meteor/mongo";

import { Log } from "meteor/convexset:log";
import { AccessCheck } from "meteor/convexset:access-check";

console.log("************************************************************");
console.log("* Server Started at", new Date());
console.log("************************************************************");
// AccessCheck.DEBUG_MODE = true;

////////////////////////////////////////////////////////////////////////////////
// The Checks
////////////////////////////////////////////////////////////////////////////////
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
	checkName: "some-check",
	checkFunction: function() {
		console.log("[check|some-check]");
		return true;
	}
});

////////////////////////////////////////////////////////////////////////////////
// The Methods
////////////////////////////////////////////////////////////////////////////////
AccessCheck.makeMethod({
	name: "some-method",
	body: function({
		someNumber
	}) {
		console.log(`[method] someNumber: ${someNumber}`);

		// selecting none of the below blocks will lead to the complaint that
		// a milestone check was not run

		// this block works
		AccessCheck.executeCheck({checkName: "some-check"});
		AccessCheck.milestoneAssertion("some-milestone");
		thingCollection.insert({type: "method", someNumber: someNumber, ts: new Date()});

		// this block works
		// Meteor.call("run-some-check-in-plain-method");
		// AccessCheck.milestoneAssertion("some-milestone");
		// thingCollection.insert({type: "method", someNumber: someNumber, ts: new Date()});

		// this block works
		// Meteor.call("run-some-check-in-access-checked-method");
		// AccessCheck.milestoneAssertion("some-milestone");
		// thingCollection.insert({type: "method", someNumber: someNumber, ts: new Date()});

		// this fails: check-not-run-before-milestone
		// AccessCheck.milestoneAssertion("some-milestone");

		// this fails: Mongo write happened before required checks done
		// thingCollection.insert({type: "method", someNumber: someNumber, ts: new Date()});

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
	"run-some-check-in-plain-method": function() {
		AccessCheck.executeCheck({checkName: "some-check"});
	}
});

AccessCheck.makeMethod({
	name: "run-some-check-in-access-checked-method",
	body: function() {},
	accessChecks: ["some-check"],
});

////////////////////////////////////////////////////////////////////////////////
// The Collections and Publications
////////////////////////////////////////////////////////////////////////////////
var thingCollection = new Mongo.Collection("things");
if (Meteor.isServer) {
	Meteor.startup(function() {
		thingCollection.remove({});
	});

	AccessCheck.makePublication({
		name: "some-pub",
		body: function({
			someNumber
		}) {
			console.log(`[pub] someNumber: ${someNumber}`);
			// yes, we know that it is totally not recommended to write to the DB in publications
			thingCollection.insert({type: "pub", someNumber: someNumber, ts: new Date()});
			
			// either of these three will make things work
			AccessCheck.executeCheck({checkName: "some-check"});
			// Meteor.call("run-some-check-in-plain-method");
			// Meteor.call("run-some-check-in-access-checked-method");

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
			console.log(`[some-pub-that-fails] someNumber: ${someNumber}`);

			// this write will succeed; it is just the reads that require a check
			// also, yes, it is totally not recommended to write to the DB in publications
			thingCollection.insert({type: "failing-pub", someNumber: someNumber, ts: new Date()});

			// this read will fail; because "some-check" was not performed
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
			console.log("********************************************************************************");
			console.log("Data at", new Date());
			thingCollection.find().forEach((x, idx) => console.log(`[${idx}]`, x));
			console.log("********************************************************************************");
		});
	});
}

////////////////////////////////////////////////////////////////////////////////
