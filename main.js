import { Meteor } from "meteor/meteor";
import { check } from "meteor/check";
import { Mongo } from "meteor/mongo";

import { Log } from "meteor/convexset:log";
import { AccessCheck } from "meteor/convexset:access-check";


/* global _Log: true */
/* global _check: true */
Meteor.startup(function() {
	if (Meteor.isDevelopment) {
		_Log = Log;
		_check = check;
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

AccessCheck.makeMethod({
	name: "some-method",
	body: function({
		someNumber
	}) {
		console.log(`[method] someNumber: ${someNumber}`);
		return someNumber;
	},
	schema: {
		someNumber: {
			type: Number
		}
	},
	accessChecks: ["some-number-at-least-5"],
});

/* global thingCollection: true */
thingCollection = new Mongo.Collection("things");
if (Meteor.isServer) {
	Meteor.startup(function() {
		thingCollection.remove({});
		_.times(3, function(idx) {
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
			return thingCollection.find();
		},
		schema: {
			someNumber: {
				type: Number
			}
		},
		accessChecks: ["some-number-at-least-5"],
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
			onReady: p => console.log(`[sub|cb|onReady] ${p}`),
			onError: p => console.log(`[sub|cb|onError] ${p}`),
			onStop: p => console.log(`[sub|cb|onStop] ${p}`)
		};

		setTimeout(function() {
			console.log(`Calling: Meteor.subscribe("some-pub", {someNumber: 2}, subCallbacks)`);
			Meteor.subscribe("some-pub", {someNumber: 2}, subCallbacks);
		}, 5000);

		setTimeout(function() {
			console.log(`Calling: Meteor.subscribe("some-pub", {someNumber: 12}, subCallbacks)`);
			Meteor.subscribe("some-pub", {someNumber: 12}, subCallbacks);
		}, 10000);
	});
}


if (Meteor.isClient) {
	setTimeout(function() {
		console.log(`Calling: Meteor.call("some-method", {someNumber: 10}, (err, res) => console.log(err, res))`);
		Meteor.call("some-method", {someNumber: 10}, (err, res) => console.log(err, res));
	}, 3000);

	setTimeout(function() {
		console.log(`Calling: Meteor.call("some-method", {someNumber: 1}, (err, res) => console.log(err, res))`);
		Meteor.call("some-method", {someNumber: 1}, (err, res) => console.log(err, res));
	}, 4000);
}
