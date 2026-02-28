import { ObjectId } from "mongodb"

export interface User {
  _id?: ObjectId,
  firstName: string,
  lastName: string,
  username: string,
  password: string,
  role: string,
  createdAt: Date,
  updatedAt: Date
}

export interface UserJwtPayload {
  _id: ObjectId,
  firstName: string,
  lastName: string,
  username: string,
  role: string
}
