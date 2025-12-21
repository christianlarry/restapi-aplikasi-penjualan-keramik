import {Db, MongoClient} from "mongodb"
import { logger } from "@application/logging"

// VAR
const mongodbUri:string = process.env.MONGODB_URI || ""
const dbName:string = process.env.MONGODB_DB_NAME || ""
const strConnSuccess:string = "✅ Connected to MongoDB"
const strConnFailed:string = "❌ MongoDB Connection Error:"
const strIsConnected:string = "Already connected to MongoDB"

const client = new MongoClient(mongodbUri)

let isConnected = false; // Prevent multiple connections
let db:Db

const connectToMongoDB = async () => {
  if (isConnected) {
    logger.info(strIsConnected);
    return;
  }
  
  try {
    await client.connect();
    isConnected = true;
    logger.info(strConnSuccess);

    db = client.db(dbName)

  } catch (err) {
    logger.error(strConnFailed, err);
    process.exit(1);
  }
};

export{
  connectToMongoDB,
  client,
  db
}