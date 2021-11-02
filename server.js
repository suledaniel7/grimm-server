const express = require('express');
const app = express();
const http = require('http').Server(app);
const admin = require('firebase-admin');
const serviceAccount = require('./firebase_service_account.json');//replace the path in quotes with the path to your Firebase Service Account file
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const md5 = require('md5');
const bcrypt = require('bcrypt');
const twilio = require('twilio');
const twilio_account_sid = "";//replace with Twilio Account SID
const twilio_auth_token = "";//replace with Twilio Auth Token
const twilio_phone_number = ""//replace with Twilio Phone Number
const client = twilio(twilio_account_sid, twilio_auth_token);

app.post('/create-account', createAccount);

app.post('/update-profile', updateProfile);

app.get('/find-by-id/:id', findByID);

app.get('/find-by-name/:name', findByName);

app.get('/message-history/:uid/:fid', messageHistory);

app.post('/send-message', sendMessage);

app.post('/delete-message/:mid/:uid', deleteMessage);

/* CREATE USER ACCOUNT */
// Requirements: first_name, last_name, phone_number, password
function createAccount(req, res) {
    let { f_name, l_name, phone, password } = req.body;//obtain the required information from the body of the request
    if (f_name.length == 0 || l_name.length == 0 || phone.length == 0 || password.length == 0) {//verify that actual data was provided
        res.send({ data: "Required fields not filled out" });//if any of the fields is empty, send this response
    }
    else {
        let d = new Date();//we need a unique identifier for each user, so we'll use the time of signup to create this
        let uid = md5(d.getTime().toString());//finally, we create an MD5 hash of the timestamp to get a String identifier
        //we need to hash the password provided. Plain-text passwords are a security risk
        bcrypt.hash(password, 5).then((hashed_password) => {//hash the password with 5 hashing rounds
            db.collection('users').doc(uid).create({//create the user document in the database with our uid as the document id
                first_name: f_name,
                last_name: l_name,
                phone_number: phone,
                password: hashed_password,
                uid: uid
            }).then(() => {
                res.send({ data: "Account Created Successfully!" });
            });
        }).catch(e => {
            res.send({ data: "An error occured" });
            console.log(e);
        });
    }
}
/* UPDATE USER PROFILE */
function updateProfile(req, res) {
    let { uid, f_name, l_name, phone, current_password, new_password } = req.body;
    if (uid.length == 0 || f_name.length == 0 || l_name.length == 0 || phone.length == 0) {
        res.send({ data: "Required fields not filled out" });
    }
    else {
        //verify that the user account exists
        db.collection('users').doc(uid).get().then((snapshot) => {
            if (snapshot.exists) {
                //password doesn't have to be changed. However, if a new password is provided then we assume that it should be changed
                if (new_password.length > 0) {
                    //we have to verify that the current password is accurate
                    //the password in the database is hashed, so we must use bcrypt.compare and not just an == to verify
                    bcrypt.compare(current_password, snapshot.get('password')).then((same) => {
                        if (same) {
                            //now, hash the new password
                            bcrypt.hash(new_password, 5).then((hashed) => {
                                db.collection('users').doc(uid).update({
                                    first_name: f_name,
                                    last_name: l_name,
                                    phone_number: phone,
                                    password: hashed
                                }).then(() => {
                                    res.send({ data: "Profile Updated Successfully!" });
                                }).catch(e => {
                                    res.send({ data: "An error occured" });
                                    console.log(e);
                                });
                            }).catch(e => {
                                res.send({ data: "An error occured" });
                                console.log(e);
                            });
                        }
                        else {
                            res.send({ data: "Incorrect Current Password" });
                        }
                    }).catch(e => {
                        res.send({ data: "An error occured" });
                        console.log(e);
                    });
                }
                else {
                    db.collection('users').doc(uid).update({
                        first_name: f_name,
                        last_name: l_name,
                        phone_number: phone
                    }).then(() => {
                        res.send({ data: "Profile Updated Successfully!" });
                    }).catch(e => {
                        res.send({ data: "An error occured" });
                        console.log(e);
                    });
                }
            }
            else {
                res.send({ data: "Account not found" });
            }
        }).catch(e => {
            res.send({ data: "An error occured" });
            console.log(e);
        });
    }
}
/* FIND USER BY ID */
function findByID(req, res) {
    let uid = req.params.id;
    if (uid.length > 0) {
        db.collection('users').doc(uid).get().then((snapshot) => {
            if (snapshot.exists) {
                //nullify the password before sending;
                let uData = snapshot.data();
                uData.password = null;

                res.send({ data: "Account found", user: uData });
            }
            else {
                res.send({ data: "Account not found" });
            }
        }).catch(e => {
            res.send({ data: "An error occured" });
            console.log(e);
        });
    }
    else {
        res.send({ data: "No ID received" });
    }
}
/* FIND USER BY NAME */
function findByName(req, res) {
    let name = req.params.name;
    if (name.length > 0) {
        db.collection('users').where('first_name', '==', name).get().then((snapshot_one) => {
            db.collection('users').where('last_name', '==', name).get().then((snapshot_two) => {
                let users = [];
                snapshot_one.forEach((user) => {
                    let uData = user.data();
                    uData.password = null;
                    users.push(uData);
                });

                snapshot_two.forEach((user) => {
                    let uData = user.data();
                    uData.password = null;
                    users.push(uData);
                });

                if (users.length > 0) {
                    res.send({ data: "Match found", users: users });
                }
                else {
                    res.send({ data: "No Match found", users: users });
                }
            }).catch(e => {
                res.send({ data: "An error occured" });
                console.log(e);
            });
        }).catch(e => {
            res.send({ data: "An error occured" });
            console.log(e);
        });
    }
    else {
        res.send({ data: "No Name received" });
    }
}
/* GET USER MESSAGE HISTORY WITH FRIEND */
function messageHistory(req, res) {
    let { uid, fid } = req.params;//uid: current user; fid: friend's ID
    if (uid.length > 0 && fid.length > 0) {
        //get all messages sent from user to friend
        db.collection('messages').where('sender', '==', uid).where('receiver', '==', fid).get().then((snapshot_one) => {
            //get all messages sent from friend to user
            db.collection('messages').where('sender', '==', fid).where('receiver', '==', uid).get().then((snapshot_two) => {
                let messages = [];
                snapshot_one.forEach((message) => {
                    messages.push(message.data());
                });
                snapshot_two.forEach((message) => {
                    messages.push(message.data());
                });

                //sort

                res.send({ data: "Successful!", messages: messages });
            }).catch(e => {
                res.send({ data: "An error occured" });
                console.log(e);
            });
        }).catch(e => {
            res.send({ data: "An error occured" });
            console.log(e);
        });
    }
    else {
        res.send({ data: "Incomplete request" });
    }
}
/* SEND MESSAGE */
function sendMessage(req, res) {
    let { uid, fid, message } = req.body;
    if (uid.length == 0 || fid.length == 0 || message.length == 0) {
        res.send({ data: "Invalid Request" });
    }
    else {
        //verify that both accounts exist
        db.collection('users').doc(uid).get().then((snapshot_one) => {
            if (snapshot_one.exists) {
                db.collection('users').doc(fid).get().then((snapshot_two) => {
                    if (snapshot_two.exists) {
                        //both accounts exist. Create message
                        let d = new Date();
                        let mid = md5(d.getTime().toString());// create unique identifier for message
                        let messageData = {
                            text: message,
                            from: uid,
                            to: fid,
                            on: d,
                            mid: mid
                        }

                        db.collection('messages').doc(mid).create(messageData).then(() => {
                            //send SMS to receiver
                            client.messages.create({
                                from: twilio_phone_number,
                                to: snapshot_two.get('phone_number'),//friend's phone number
                                body: message
                            }).then(() => {
                                res.send({ data: "Message Sent!" });
                            }).catch(e => {
                                res.send({ data: "An error occured" });
                                console.log(e);
                            });
                        }).catch(e => {
                            res.send({ data: "An error occured" });
                            console.log(e);
                        });
                    }
                    else {
                        res.send({ data: "Invalid Account" });
                    }
                }).catch(e => {
                    res.send({ data: "An error occured" });
                    console.log(e);
                });
            }
            else {
                res.send({ data: "Invalid Account" });
            }
        }).catch(e => {
            res.send({ data: "An error occured" });
            console.log(e);
        });
    }
}
/* DELETE MESSAGE */
function deleteMessage(req, res) {
    let { mid, uid } = req.body;//get both the message and current user ID
    if (mid.length > 0 && uid.length > 0) {
        db.collection('messages').doc(mid).get().then((snapshot) => {
            if (snapshot.exists) {
                //verify that the current user is the creator of the message
                if (snapshot.get('from') == uid) {
                    //the current user is the creator of the message and can delete it
                    db.collection('messages').doc(mid).delete().then(() => {
                        res.send({ data: "Message Deleted!" });
                    }).catch(e => {
                        res.send({ data: "An error occured" });
                        console.log(e);
                    });
                }
                else {
                    res.send({ data: "Access Denied" });
                }
            }
            else {
                res.send({ data: "Message not found" });
            }
        }).catch(e => {
            res.send({ data: "An error occured" });
            console.log(e);
        });
    }
    else {
        res.send({ data: "No ID received" });
    }
}

http.listen(5688, () => {
    console.log("Chat Server running at Port 5688");
});