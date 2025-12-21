import { getDb } from "@/config/mongodb"
import { User } from "@/interfaces/user.interface"

export const userModel = () => {
  return getDb().collection<User>("users")
}