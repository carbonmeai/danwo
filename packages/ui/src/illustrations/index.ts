import { Company } from "./company"
import { Dashboard } from "./dashboard"
import { Entities } from "./entities"
import { File } from "./file"
import { Folder } from "./folder"
import { Lists } from "./lists"
import { Message } from "./message"
import { Note } from "./note"
import { Notification } from "./notification"
import { Person } from "./person"
import { Reports } from "./reports"
import { Search } from "./search"
import { Task, TaskProject } from "./task"
import { Unplugged } from "./unplugged"

/**
 * 80px line illustrations for empty states and pickers. They take their colour
 * from the .empty-state-illustration class in the global theme, so a card only
 * has to set the tint behind them.
 */
export const Illustrations = {
  company: Company,
  dashboard: Dashboard,
  file: File,
  folder: Folder,
  lists: Lists,
  message: Message,
  note: Note,
  notification: Notification,
  person: Person,
  record: Entities,
  reports: Reports,
  search: Search,
  task: Task,
  taskProject: TaskProject,
  unplugged: Unplugged,
}
