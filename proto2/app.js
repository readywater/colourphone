/************************
 * Startup dependencies. *
*************************/
var express = require('express'), 
		OAuth = require('oauth').OAuth,
		io = require('socket.io'),
//		connect = require('connect'), //Automatic in express I think?
		winston = require('winston'),
 		util = require('util');

//Session stores
var sessionStore = new express.session.MemoryStore();
var MongoStore = require('connect-mongo');

//Mongo stores
var	mongoose = require('mongoose'), 
		mongooseAuth = require('mongoose-auth'),
		conf = require('./config.js');

var everyauth = require('everyauth')
  , Promise = everyauth.Promise;

/// Everyauth stuff and mongoose
everyauth.debug = true;
everyauth.everymodule.moduleErrback( function (err) {
  console.log ( err );
});

//Connect to Database
var db = mongoose.connect('mongodb://localhost/colour', function(err) {
	if( err ) {	console.log(err); }
	else { console.log("Successful connection"); }
});

var app = module.exports = express.createServer();


/************************
 * Database setup       *
*************************/

//Database model
var Schema = mongoose.Schema
  , ObjectId = Schema.ObjectId;
	
var userSchema = new Schema({
	name					: {
		first	: String
		, last: String
	}		
	, friends			: [friendSchema]
	, joined			: Date
	, online			: Boolean
}), User;

var friendSchema = new Schema({
	id: String
	, name: String
	, colour: [colourSchema]
}), friend;

var colourSchema = new Schema({
	model: { type: String, default: 'RGB' }
	, val1: Number
	, val2: Number
	, val3: Number
	, sent: Date
	, received: Boolean
	, replied : Boolean
}), colour;

userSchema.plugin(mongooseAuth, {
  everymodule: {
    everyauth: {
      User: function() {
        return User;
      }
    }
  },
  facebook: {
    everyauth: {
      myHostname: 'http://emote.me:8000',
      appId: conf.fb.appId,
      appSecret: conf.fb.appSecret,
      redirectPath: '/',
			//findOrCreateUser: function (session, accessToken, fbUserMetadata) {}
    }
  },
  twitter: {
    everyauth: {
      myHostname: 'http://emote.me:8000',
      consumerKey: conf.twit.consumerKey,
      consumerSecret: conf.twit.consumerSecret,
      redirectPath: '/',
	//		findOrCreateUser: function (session, accessToken, twitterUserMetadata) {}
    }
  }
});

mongoose.model('User', userSchema);

User = mongoose.model('User');	

//var colorObject = mongoose.model('Colour', colourSchema);
//var userObject = mongoose.model('User', userSchema);

/************************
 * Server config        *
*************************/

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
	app.use(express.cookieParser());
	app.use(express.session({ 
		secret: '024493'
		, key: 'express.sid'
		, store  : new MongoStore({ db: 'colour' }) }));
  app.use(express.static(__dirname + '/public'));
  app.use(mongooseAuth.middleware());
});

//Socket.io and express joiner
app.use(express.session({store: sessionStore
    , secret: 'secret'
    , key: 'express.sid'}));

/* // Tests the session function/get ID
app.use(function (req, res) {
    res.end('<h2>Hello, your session id is ' + req.sessionID + '</h2>');
	}); */

mongooseAuth.helpExpress(app);

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
  app.use(express.errorHandler()); 
});


/************************
/************************
/************************
/*************************
 * Websockets and returns *
*************************/
var io = io.listen(app);
var userCount = 0;
var colordata = {};


/***********************************************
 * Session wrangling														*
 * http://www.danielbaulig.de/socket-ioexpress/ *    
************************************************/
var Session = express.session.Session;

io.set('authorization', function (data, accept) {
	
  console.log( data.headers )
 
  if (data.headers.cookie) {
    data.cookie = JSON.stringify(data.headers.cookie).split('=')[1];
    data.sessionID = data.cookie['express.sid'];
    data.sessionStore = sessionStore;
    
    sessionStore.get(data.sessionID, function (err, session) {
      if (err) {
        accept(err.message.toString()+'. u mad?', false);
      } else {
        data.session = new Session(data, JSON.stringify(session) );
        console.log('User authorized: ' + JSON.stringify(data.session) );
        accept(null, true);
			}

    });
    console.log('cookie: ', data.cookie)
  } else {
   // if there isn't, turn down the connection with a message
   accept('No cookie transmitted, no connection', false);
  }
});
	
//Socket.io handling		
io.sockets.on('connection', function (socket) {
  	socket.join(socket.handshake.sessionID);
    var hs = socket.handshake;
//		var sesColours = new Array();
    console.log('A socket with sessionID ' + hs.sessionID 
        + ' connected!');
    socket.emit('ready');
		socket.emit('colour', colordata, function() {
			console.log('Current colour sent.')
		});

	  var intervalID = setInterval(function () {
	    socket.handshake.session.reload( function () {
				try{
	        socket.handshake.session.touch().save();
					} catch(err) { console.log(err); }
	    }); }, 60 * 1000);

		socket.on('msg', function (data) {	
				console.log('Current session: ' + JSON.stringify(hs.session) );
				try {
					var userModel = new User();	
					var userID = hs.session.twitId;
					User.findOne(
						{ 'twit.id' : hs.session.twitId },
						function(err, p) {
							if(err) {
								console.log('No permission for ' + hs.session.twitId + 
							' to contact ' + data.id );
						} else {
							for( var key in p.friends) {
						  if( p.friends[key].id == data.id){
							if( p.friends[key].colour === undefined ) p.friends[key].colour = new Array();
								var colourObject = { 'colour' : {
													'model'  : 'RGB'
													, 'val1' : data.val1
													, 'val2' : data.val2
													, 'val3' : data.val3
													, 'sent' : data.timestamp
													, 'received' : false
													, 'replied'  : false
												}
											};
								p.friends[key].colour.push( JSON.stringify(colourObject) );
								console.log("Found friend and adding colour" + colourObject + p);
								p.save( function(err) {
									console.log('Saved, or err?' + err)
										});

									}
								}
							}
						} );
					} catch(err) {
						console.log('An error occured updating colour: ' + err);
					}
					
			//		userToInsert.friends.push({})
					

			/*		userToInsert.update( { 'friends.id': data.id, 'twit.id' : hs.session.twitId }
							, { $set : {
								  'friends.$.colour'  : {
										'model'  : data.type
										, 'val1' : data.val1
										, 'val2' : data.val2
										, 'val3' : data.val3
										, 'sent' : data.timestamp
										, 'received' : false
										, 'replied'  : false
										}
									}
								 },
								function(err) {
									if(err) console.log(err);
									console.log( 'Recieved colour from ' 
									+ data.id + ' and saved to ' 
									+ hs.session.twitId );
						} );
					} catch(err) { console.log('Unable to update ' + err)} */
					/*
					userToInsert.friends.id[data.id].colour = {
								'model'  : data.type
								, 'val1' : data.val1
								, 'val2' : data.val2
								, 'val3' : data.val3
								, 'sent' : data.timestamp
								, 'received' : false
								, 'replied'  : false
					};
					
					userToInsert.save( function(err) {
						if(err) console.log('Problem saving: ' + err)
					});*/
		
			//	socket.broadcast.emit('colour', data );
/*					if( sesColours.id[data.id] === undefined) {
					sesColours.push = {
						id: data.id
						, friend: hs.session.twitId
						, color: {
										'model'  : data.type
										, 'val1' : data.val1
										, 'val2' : data.val2
										, 'val3' : data.val3
										, 'sent' : data.timestamp
										, 'received' : false
										, 'replied'  : false
										}
									}
								} 
				else {
					sesColours.id['friends.id']= {
						id: friends.id
						, friend: hs.session.twitId
						, color: {
										'model'  : data.type
										, 'val1' : data.val1
										, 'val2' : data.val2
										, 'val3' : data.val3
										, 'sent' : data.timestamp
										, 'received' : false
										, 'replied'  : false
										}
									}
								}
					*/
		});

		socket.on('you', function(data) {
			hs.session.twitId = data;
			console.log("WE GOTS THE ID! See: " + hs.session.twitId );
		});

		socket.on('isUpdate', function(data) {
			var reply = [];
			var response = User.findOne({ 'twit.id' : hs.session.twitId });
			console.log('Just got pinged from ' + hs.session.twitId );
			for( var key in response.friends) {
				if( response.friends[key].colour.recieved == false ) {
					reply.push(response.friends[key].colour);
				}	
			}
			socket.emit('update', reply);
		});

    socket.on('disconnect', function () {
        console.log('A socket with sessionID ' + hs.sessionID 
            + ' disconnected!');
						if( sessionStore ) {
							User.update( { },{}, function(err) {
								if(err) console.log(err);
								console.log('Offline:' + JSON.stringify(everyauth.user));
							});
						}

        clearInterval(intervalID);
		//		clearInterval(interval);
    });
	});


/************************
 *  Routing and app      *
*************************/
//var theUser = new User({});

app.get('/', function(req, res){
	io.sockets.in(req.sessionID).send('Man, good to see you back!');
	if( req.loggedIn ) {
		req.session.id = req.user._id;
		req.session.twitter = req.user.twit.id;
		User.update( { 'twit.id' : req.user.twit.id }, { online: true }, function(err) {
			if(err) console.log(err);
			console.log('Online:' + JSON.stringify(req.user));
			} );
		}
	res.cookie('colourphone', 'yes', { 
			expires: new Date(Date.now() + 900000)
			, httpOnly: true
			, secure: true 
		});
  res.render('index', {
    title: 'Colour Phone v0.2'
		, auth: everyauth.loggedIn
		, twitter: everyauth.twitter.user
		, facebook: everyauth.facebook.user
		, response: ''
  });
});


app.get('to/:id', function(req,res) {
	var hasAccess = false;
	io.sockets.in(req.sessionID).send('Man, good to see you back!');
	if( req.loggedIn ) {
		req.session.id = req.user._id;
		req.session.twitter = req.user.twit.id;
		User.update( { 'twit.id' : req.user.twit.id }, { online: true }, function(err) {
			if(err) console.log(err);
			console.log('Online:' + JSON.stringify(req.user));
			} );
		}
	res.cookie('colourphone', 'yes', { 
			expires: new Date(Date.now() + 900000)
			, httpOnly: true
			, secure: true 
		});
		
	var cc = io
		.of('/colour')
		.on('authorization', function(accept, err) {
			console.log( data.headers )
		})
		.on('connection', function(socket) {
				var friend = User.find( {'_id': req.session._id, }, function(err, docs) {
					for( friends in docs.friends ){
						if( friends.id == req.params.id ) {
							hasAccess = true;
						}
					
					if( hasAccess ) {
						User.find( { '_id' : req.sessionID } )
						}
					}
				});
			 	socket.emit('colour', {});
			});
		
  res.render('friend', {
    title: 'Colour Phone v0.2 to ' +  req.params.id
		, response: ''
  });
});

app.get('/login', function(req, res) {
	res.render('login', {
		title: 'Login',
		
	});
});

app.listen(8000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
	
/************************
 *  Get Twitter friends *
*************************/
function makeOAuth() {
	return new oauth.OAuth('https://api.twitter.com/oauth/request_token',
	'https://api.twitter.com/oauth/access_token',
	conf.twit.consumerKey,
	conf.twit.consumerSecret,
	'1.0',
	null,
	'HMAC-SHA1');
}


app.get('/friends', function(req, res) {
	var response = '';
	var friendIds = [];

	var oa = new OAuth('https://api.twitter.com/oauth/request_token'
								, 'https://api.twitter.com/oauth/access_token'
								, conf.twit.consumerKey
								, conf.twit.consumerSecret
								, '1.0'
								, null
								, 'HMAC-SHA1');

	//Grab twitter friends list
  oa.getProtectedResource("http://api.twitter.com/1/friends/ids.json"
		, "GET"
		, req.session.auth.twitter.accessToken
		, req.session.auth.twitter.accessTokenSecret
		, function (error, data) {
	    	if (error) {
		      console.log("Prob getting followers: " + JSON.stringify(error) );
					console.log("accessToken: " +  req.session.auth.twitter.accessToken );
					console.log("accessSecret: " + req.session.auth.twitter.accessTokenSecret );
					console.log("User data: " + JSON.stringify(req.session.auth) );
		    	}
		    var obj = JSON.parse(data);
				console.log( "Recieved object:" + JSON.stringify(obj) );

				//Grab and compare from mongodb
				User.find({ 'twit.id' : { $in : obj.ids } }, function(err, docs) {
					if (err) { console.log("Error retrieving friends: " + err); }
					console.log( "Returned db matches: " + JSON.stringify( docs ) );
					response = docs;
					for(var key in docs) {
						if(docs.hasOwnProperty(key)){
								friendIds.push({ 
										"id" : docs[key].twit.id
										, "name" : docs[key].twit.name 
									});
							}
						}
					 console.log( "Friends list to be saved: " + JSON.stringify(friendIds) );
						var friends = JSON.parse( JSON.stringify(friendIds), function() {
							console.log(friends);
						});
						User.update( { 'twit.id' : req.user.twit.id }
							, { 'friends' : friendIds	}
							, function(err) {
							if(err) { console.log("Error updating friends list: " + err); }
							else { console.log("Friends list Saved to " + req.user.twit.id); }
							//If update successful, then serve documents.
						  if (req.xhr) {
						    res.partial('user', { 
									friends : friendIds
									}, function(err, ret) {
										
										res.send({ friends: friendIds, you: req.user.twit.id, html : ret});
										console.log("Sent friend list" + ret + ", err? " + err);
									});
						  }
							else {
								res.render('users', { friends : friendIds });
							}							
						});
					});
				});
		});

app.get('/logout', function (req, res) {
    req.logout();
    res.redirect('/');
});