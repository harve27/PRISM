//init
const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const fs = require("fs");
const axios = require("axios");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(express.static("public"));
app.use(cookieParser());

//init sqlite db
const dbFile = "./.data/sqlite.db";
const exists = fs.existsSync(dbFile);
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database(dbFile);

app.get("/", (request, response) => {
  response.sendFile(`${__dirname}/views/index.html`);
});

//static routing
app.use("/pages",express.static(`${__dirname}/views/pages`));
app.use("/views",express.static(`${__dirname}/views`));

//endpoint to get all businesses in database
app.get("/getBusiness", (request, response) => {
  db.all(`SELECT * FROM Businesses WHERE id = (?)`, request.query.id, (err, rows) => {
    if ( err ) throw err;
    if ( rows == 0 ) return response.send(null);
    response.send(JSON.stringify(rows[0]));
  });
});

//add business to db
app.get("/signUp", (request, response) => {
  console.log(request.query);
  if ( ! request.query.name || ! request.query.password || ! request.query.name ) response.redirect("/");
  var id = Math.floor(Math.random() * 1e9);
  db.run(
    `INSERT INTO Businesses VALUES ((?),(?),(?),(?),(?),(?),(?),(?),(?),(?),(?),(?),(?),(?),(?),(?),(?))`,
    id,
    request.query.name,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    err => {
      if ( err ) throw err;
      bcrypt.hash(request.query.password,10,function(err,hash) {
        if ( err ) throw err;
        db.run(
          `INSERT INTO Users VALUES ((?),(?),(?),(?))`,
          id,
          request.query.username,
          hash,
          "",
          err => {
            if ( err ) throw err;
            assignToken(id,request.query.username,response);
          }
        );
      });
    }
  );
});

app.get("/login",(request,response) => {
  db.all(`SELECT id,hash FROM Users WHERE username = (?)`,request.query.username,(err,rows) => {
    if ( err ) throw err;
    if ( rows.length == 0 ) return response.send("fail");
    var id = rows[0].id;
    var hash = rows[0].hash;
    console.log(hash,request.query.password);
    bcrypt.compare(request.query.password,hash,(err,result) => {
      if ( err ) throw err;
      if ( result ) {
        assignToken(id,request.query.username,response);
      } else {
        response.send("fail");
      }
    })
  });
});

function assignToken(id,username,response) {
  crypto.randomBytes(32,function(err,buffer) {
    if ( err ) throw err;
    var token = buffer.toString("hex");
    db.run("UPDATE Users SET tokens = (?) WHERE username = (?)",token,username,err => {
      if ( err ) throw err;
      response.cookie("token",token).redirect(`/pages/bizprofile.html?id=${id}`);
    });
  });
}

function checkToken(id,token,callback) {
  db.all("SELECT tokens FROM Users WHERE id = (?)",id,(err,rows) => {
    if ( err ) throw err;
    if ( rows.length == 0 ) return callback(false);
    callback(rows[0].tokens == token);
  });
}

function getBusinessAvgOfTag(tag,callback) {
  db.all("SELECT AVG(priceAvg) FROM Businesses WHERE instr(tags,(?)) > 0",tag,(err,rows) => {
    if ( err ) throw err;
    if ( rows.length == 0 ) return;
    callback(rows[0]["AVG(priceAvg)"]);
  });
}

function getCustomerAvgOfTag(tag,callback) {
  db.all("SELECT id FROM Businesses WHERE instr(tags,(?)) > 0",tag,(err,rows) => {
    if ( err ) throw err;
    var ids = rows.map(item => item.id);
    db.all("SELECT id,price FROM Feedback",(err,out) => {
      if ( err ) throw err;
      var prices = out.filter(item => ids.includes(item.id)).map(item => item.price);
      var avg;
      if ( prices.length > 0 ) avg = prices.reduce((a,b) => a + b) / prices.length;
      else avg = 0;
      callback(avg);
    });
  });
}

function iterateTags(tags,callback,index,obj) {
  if ( ! index ) index = 0;
  if ( ! obj ) obj = {};
  getBusinessAvgOfTag(tags[index],function(bAvg) {
    getCustomerAvgOfTag(tags[index],function(cAvg) {
      obj[tags[index]] = {bAvg,cAvg}
      if ( index + 1 >= tags.length ) return callback(obj);
      else iterateTags(tags,callback,index + 1,obj);
    });
  });
}

app.get("/getAnalytics",(request,response) => {
  checkToken(request.query.id,request.cookies.token,function(result) {
    if ( ! result ) return response.send("fail1");
    db.all("SELECT tags FROM Businesses WHERE id = (?)",request.query.id,(err,rows) => {
      if ( err ) throw err;
      if ( rows.length == 0 ) return response.send("fail");
      var tags = rows[0].tags.split(",");
      iterateTags(tags,function(priceObj) {
        db.all("SELECT obj,email,price FROM Feedback WHERE id = (?)",request.query.id,(err,rows) => {
          if ( err ) throw err;
          response.send(JSON.stringify({
            feedback: rows,
            prices: priceObj
          }));
        });
      });
    });
  });
});

app.get("/checkToken",(request,response) => {
  console.log(request.cookies.token);
  checkToken(request.query.id,request.cookies.token,function(result) {
    if ( result ) response.send("true");
    else response.send("false");    
  });
});

//search bar function
app.get("/search",(request,response) => {
  request.query.search
  db.all("SELECT * FROM Businesses",(err,rows) => {
    if ( err ) throw err;
    var matches = [];
    for ( var i in rows ) {
      if (
        (rows[i].tags || "").indexOf(cleanString(request.query.search)) > -1 ||
        (rows[i].name || "").indexOf(cleanString(request.query.search)) > -1 ||
        (rows[i].description || "").indexOf(cleanString(request.query.search)) > -1
      ) matches.push(rows[i]);
    }
    //get ip, get location
    var ip = request.headers["x-forwarded-for"] || request.connection.remoteAddress;
    axios.get(`http://api.ipstack.com/${ip.split(",")[0]}?access_key=44d8862c96df6317381286de7e139c53&format=1`).then(ipData => {
      var out = matches.sort((a,b) => Math.random() - 0.5);
      response.send(out);
    });
  });
});

app.get("/submitSurvey",(request,response) => {
  console.log(request.query);
  var id = request.query.id;
  var ip = request.headers["x-forwarded-for"] || request.connection.remoteAddress;
  db.run(
    `INSERT INTO Feedback VALUES ((?),(?),(?),(?),(?),(?),(?))`,
    id,
    Math.floor(Math.random() * 1e9),
    request.query.obj,
    request.query.rating,
    request.query.price,
    request.query.email,
    ip,
    err => {
      if ( err ) throw err;
      response.send("ok");
    }
  );
});

app.get("/updateBusiness",(request,response) => {
  var items = [
    "name",
    "address",
    "description",
    "tags",
    "zipcode",
    "phone",
    "email",
    "url",
    "covidRestrictions"
  ];
  var sequence = "";
  for ( var i in items ) {
    sequence += `${items[i]}="${cleanString(request.query[items[i]])}"`;
    if ( i < items.length - 1 ) sequence += ",";
  }
  console.log(sequence);
  db.run(`UPDATE Businesses SET ${sequence} WHERE id = (?)`,request.query.id,err => {
    if ( err ) throw err;
    response.send("ok");
  });
});

app.get("/getRecommended",(request,response) => {
  db.all("SELECT * FROM Businesses",(err,rows) => {
    if ( err ) throw err;
    rows = rows.sort((a,b) => Math.random() - 0.5);
    response.send(JSON.stringify(rows.slice(0,3)));
  })
});

//prevent sql injections
const cleanString = function(string){
  return string.replace(/</g, "&lt").replace(/>/g, "&gt");
};

//listening
var listener = app.listen(process.env.PORT, () => {
  console.log(`Your app is listening on port ${listener.address().port}`);
});