import express from "express";
import dotenv from "dotenv";
import path from "path";
import cors from "cors";
import mongoose from "mongoose";
import session from "express-session";
import bodyParser from "body-parser";
import MongoStore from "connect-mongo";
import http from "http";
dotenv.config({ path: "./config.env" });
const app = express();
const server = http.createServer(app);
import { Server } from "socket.io";
import { actualSessionId } from "./utils/actualSessionId.js";
import { Socket } from "dgram";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB = process.env.DATABASE_STRING.replace(
  "<password>",
  process.env.DATABASE_PASSWORD
);

mongoose
  .connect(DB)
  .then(() => {
    console.log(`database connection was successfull ! :) \n`);
  })
  .catch((error) => {
    console.log(
      `error - ${error} happened while attempting to connect to database :) \n `
    );
  });

app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "build")));

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
    exposedHeaders: ["set-cookie"],
  })
);

app.use(
  session({
    name: "sessionId",
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({
      mongoUrl: process.env.DATABASE_STRING,
      collection: "sessions", // Collection name to store sessions
      ttl: 7 * 24 * 60 * 60,
      cookie: { secure: false },
    }),
    cookie: {
      path: "/",
      secure: process.env.ENVIRONMENT === "development" ? false : true,
      httpOnly: false
    },
  })
);

app.post("/initialize-session", async (req, res) => {
  try {
    const sess = req.session;
    if (!req.session.username && !req.session.randomId) {
      req.session.randomId = req.body.randomId;
      req.session.username = req.body.username;

      const mongoStore = req.sessionStore;

      const sessionId = req.sessionID;

      const sessionCollection = mongoStore.collection;

      sessionCollection.updateOne(
        { _id: sessionId },
        {
          $set: {
            randomId: req.body.randomId,
            username: req.body.username,
          },
        }
      );
    }
    res.status(200).json({ message: "session init" });
  } catch (error) {
    res.status(404).json({ message: `session init fail ${error}` });
  }
});

app.post("/check-session", (req, res) => {
  //console.log(`/check-session get endpoint ${JSON.stringify(req.session)} `)
  if (req.session.randomId && req.session.username) {
    res.status(200).json({
      message: "randomId and username successfully added to the req.session \n",
    });
  } else {
    res.status(404).json({ message: "failed 😭" });
  }
});

let randomIdSocketsMap = new Map();

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

let socketsMap = {};

io.on("connection", async (socket) => {
  console.log(socket.id, " -in-connection- ");

  socketsMap[socket.handshake.auth.randomId] = socket.id;

  socket.on("find-partner", async () => {
    const currentRandomId = socket.handshake.auth.randomId;
    const currentUsername_ = socket.handshake.auth.username_;

    console.log( "interests of this socket " , JSON.stringify(socket.handshake.auth.interests))

    const allSockets = await io.fetchSockets();

    //check if there are any connected sockets with similar interests

    let currentInterests = (socket.handshake.auth.interests);

    let currentInterests_ = currentInterests.map((interest) => {
      return interest.trim().toUpperCase()
    });


    for ( const i of allSockets) {

       const randomId = i.handshake.auth.randomId;
       const username_ = i.handshake.auth.username_;

       console.log(
         randomId,
         " randomId ",
         i.id,
         " socket.id ",
         i.inRoom,
         " room status \n "
       );

       if (randomId !== currentRandomId && i.inRoom === undefined ) {
        
        let matchingInterests = [];

        //finding if there are any common interests
        i.handshake.auth.interests.forEach((interest) => {
          if (currentInterests_.includes(interest.trim().toUpperCase())) {
            matchingInterests.push(interest);
          }
        });

        console.log(`matching interests after comparing ${matchingInterests}`)

        if ( matchingInterests.length > 0 ) {
          let roomName =
            currentRandomId > randomId
              ? `${currentRandomId}:${randomId}`
              : `${randomId}:${currentRandomId}`;

          socket.join(roomName);

          socket.inRoom = true;

          i.join(roomName);

          i.inRoom = true;

          io.to(roomName).emit("room-joined", {
            roomName: roomName,
            participants: [
              {
                randomId: currentRandomId,
                type: "sender",
                username_: currentUsername_,
              },
              { randomId: randomId, type: "receiver", username_: username_ },
            ],
            matchingInterests: matchingInterests
          }); //this should actually be sent to both the users last observed that it is only being sent to just one...
        } else if (randomId !== currentRandomId && i.inRoom === undefined && matchingInterests.length === 0) {
          let roomName =
            currentRandomId > randomId
              ? `${currentRandomId}:${randomId}`
              : `${randomId}:${currentRandomId}`;

          socket.join(roomName);

          socket.inRoom = true;

          i.join(roomName);

          i.inRoom = true;

          io.to(roomName).emit("room-joined", {
            roomName: roomName,
            participants: [
              {
                randomId: currentRandomId,
                type: "sender",
                username_: currentUsername_,
              },
              { randomId: randomId, type: "receiver", username_: username_ },
            ],
            matchingInterests: [],
          }); //this should actually be sent to both the users last observed that it is only being sent to just one...
        }


         
       }




    }

   
  });

  socket.on("private-message", (data) => {
    io.to(data.roomName).emit("private-message", data);
  });

  
   const activeSockets = await io.fetchSockets();

   const setOfAllActualActiveUsers = new Set();

    const actualActiveSockets = [];
   activeSockets.forEach((i) => {
    setOfAllActualActiveUsers.add(i.handshake.auth.randomId);
   })

    
     console.log(`listening for active-sockets event ${setOfAllActualActiveUsers.size} ${activeSockets.length}`);

    socket.emit("active-sockets", { peopleOnline: setOfAllActualActiveUsers.size});

    socket.on("chat-disconnected" , async (data) => {

      console.log(`${JSON.stringify(data)} --- listening to chat-disconnected event on the server side`);

      let randomIdArray = []
      if (data.roomName !== null ) {
        randomIdArray = data.roomName.split(":");
      } 

      const rIdDisconnectedUser = socket.handshake.auth.randomId;


      console.log(`${rIdDisconnectedUser} --- rId of disconnected user \n`);

      const allSocketObjects = await io.fetchSockets();


      if (Array.isArray(randomIdArray)) {

         for (const i of randomIdArray) {
           if (i !== "") {
             if (i !== rIdDisconnectedUser) {
               console.log(`rId of other user in room  - ${i} `);


               for ( const j of allSocketObjects) {

                if ( j.handshake.auth.randomId === i ) {

                  j.emit("partner-disconnected" , { message: "Partner Disconnected"})

                }

               }

             }
            


           }
         }


      }
     


      //find the unique identifier of the browser associated with the other socket in the room
      //if found send a event saying the other user has disconnected 

      

      const userWhoDisconnected = socket.id;

      console.log(`${userWhoDisconnected} --- socket id of user who disconnected \n`);
      

      const currentRoomsActive = io.sockets.adapter.rooms;

  
        for ( const i of currentRoomsActive) {
           if ( i[1].has(userWhoDisconnected)) {
              console.log(i[1] , " Set containing all participants in the room \n");
              i[1].forEach((item) => {
                console.log(item , " id of socket in the room from which current user left \n ")
                if ( item != userWhoDisconnected) {

                  //emit an event and send data informing rest of participants about departure
                  const my_socket = io.sockets.sockets.get(
                    item
                  );

                  my_socket.emit("partner-disconnected" , { message: "partner disconnected"});
                  

                  const otherUserIdentity = my_socket.handshake.auth.randomId;

                  for ( const i of allSocketObjects) {
                    if ( i.handshake.auth.randomId === otherUserIdentity) {
                      i.emit("partner-disconnected" , { message: "partner disconnected "})
                    }
                  }

                }
              })


           }
        }





    })
  

  
});

const PORT = process.env.PORT;

server.listen(PORT, () => {
  console.log(` server listening on ${PORT}`);
});
