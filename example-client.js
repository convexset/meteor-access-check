import { Meteor } from "meteor/meteor";

Meteor.startup(function() {
	console.log("Edit the example-client.js file to play with what is invoked on the server.");
	console.log("Comment/uncomment the various blocks of code.");
	console.log("");
	console.log("Edit the example-setup.js file to play with the method and publication created.");
	console.log("Comment/uncomment the various blocks of code to see what happens.");
});

////////////////////////////////////////////////////////////////////////////////
// Testing Methods on the Client
////////////////////////////////////////////////////////////////////////////////
if (Meteor.isClient) {
	Meteor.startup(function() {
		function methodCB(err, res) {
			console.log("Method return:", err, res)
			console.log("---------------------------------------------");
		}

		// setTimeout(function() {
		// 	console.log("---------------------------------------------");
		// 	console.log(`(A Straight Failure) Calling: Meteor.call("some-method", {someNumber: 1}, (err, res) => console.log(err, res))`);
		// 	Meteor.call("some-method", {someNumber: 1}, methodCB);
		// }, 50);

		// setTimeout(function() {
		// 	console.log("---------------------------------------------");
		// 	console.log(`Calling: Meteor.call("some-method", {someNumber: 7}, (err, res) => console.log(err, res))`);
		// 	Meteor.call("some-method", {someNumber: 7}, methodCB);
		// }, 3000);
	});
}

////////////////////////////////////////////////////////////////////////////////
// Testing Pubs on the Client
////////////////////////////////////////////////////////////////////////////////
if (Meteor.isClient) {
	Meteor.startup(function() {
		var subCallbacks = {
			onReady: () => console.log(`[sub|cb|onReady]`),
			onError: p => console.log(`[sub|cb|onError] ${p}`),
			onStop: p => console.log(`[sub|cb|onStop] ${p}`)
		};

		setTimeout(function() {
			console.log("---------------------------------------------");
			console.log(`(A Straight Failure) Calling: Meteor.subscribe("some-pub-that-fails", {someNumber: 7}, subCallbacks)`);
			Meteor.subscribe("some-pub-that-fails", {someNumber: 7}, subCallbacks);
		}, 1000);

		// setTimeout(function() {
		//	console.log("---------------------------------------------");
		// 	console.log(`(A Straight Failure) Calling: Meteor.subscribe("some-pub", {someNumber: 2}, subCallbacks)`);
		// 	Meteor.subscribe("some-pub", {someNumber: 2}, subCallbacks);
		// }, 2000);

		// setTimeout(function() {
		// 	console.log("---------------------------------------------");
		// 	console.log(`Calling: Meteor.subscribe("some-pub", {someNumber: 6}, subCallbacks)`);
		// 	Meteor.subscribe("some-pub", {someNumber: 6}, subCallbacks);
		// }, 3000);

	});
}

////////////////////////////////////////////////////////////////////////////////
