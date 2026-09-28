import { jsonBody, request } from "@/api/client"
import type { Role } from "@/lib/auth"

// 組織管理（只有 IT，backend/app/api/admin.py）。每個寫入操作都回傳更新後的整張組織圖：
// 主管調區會連帶改掉底下每個人的轄區，畫面直接換掉整份資料，不自己推算
export type OrgUnit = {
  id: string
  name: string
  kind: "root" | "region"
  parent_id: string | null
}

export type OrgMember = {
  id: string
  name: string
  role: Role
  region: string
  email: string | null
  manager_id: string | null
  unit_id: string | null
  active: boolean
  customer_count: number
}

export type OrgLogEntry = {
  id: number
  actor_name: string
  detail: string
  created_at: string
}

export type OrgChart = {
  units: OrgUnit[]
  users: OrgMember[]
  log: OrgLogEntry[]
}

// 畫面上開得出來、改得過去的角色；IT 只從灌資料來
export type AssignableRole = "sales" | "manager"

export type NewAccount = {
  name: string
  email: string
  password: string
  role: AssignableRole
  manager_id?: string
  unit_id?: string
}

export function getOrgChart(signal?: AbortSignal) {
  return request<OrgChart>("/api/admin/org", { signal })
}

export function createAccount(body: NewAccount) {
  return request<OrgChart>("/api/admin/users", jsonBody("POST", body))
}

export function changeManager(userId: string, managerId: string) {
  return request<OrgChart>(
    `/api/admin/users/${userId}/manager`,
    jsonBody("PUT", { manager_id: managerId })
  )
}

export function moveManager(userId: string, unitId: string) {
  return request<OrgChart>(
    `/api/admin/users/${userId}/unit`,
    jsonBody("PUT", { unit_id: unitId })
  )
}

export function changeRole(
  userId: string,
  body: {
    role: AssignableRole
    manager_id?: string
    unit_id?: string
    successor_id?: string
  }
) {
  return request<OrgChart>(
    `/api/admin/users/${userId}/role`,
    jsonBody("PUT", body)
  )
}

export function deactivateAccount(userId: string, successorId?: string) {
  return request<OrgChart>(
    `/api/admin/users/${userId}/deactivate`,
    jsonBody("POST", { successor_id: successorId })
  )
}

export function reactivateAccount(userId: string) {
  return request<OrgChart>(`/api/admin/users/${userId}/reactivate`, {
    method: "POST",
  })
}

export function reassignCustomer(customerId: string, ownerId: string) {
  return request<OrgChart>(
    `/api/admin/customers/${encodeURIComponent(customerId)}/owner`,
    jsonBody("PUT", { owner_id: ownerId })
  )
}
