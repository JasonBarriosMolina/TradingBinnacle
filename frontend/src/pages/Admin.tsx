import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../lib/api'
import { PlanGate } from '../components/PlanGate'
import { formatDate } from '../lib/dateUtils'
import type { User, Plan, UserStatus } from '../shared/types'

const PLAN_OPTIONS: Plan[] = ['free', 'pro']
const STATUS_OPTIONS: UserStatus[] = ['trial', 'pending', 'active', 'suspended']

function AdminContent() {
  const qc = useQueryClient()
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.getUsers().then((r) => r.data),
  })

  const updateUser = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: Partial<User> }) =>
      adminApi.updateUser(userId, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const [editing, setEditing] = useState<string | null>(null)

  const statusColor: Record<UserStatus, string> = {
    active: 'text-[#2EA043]',
    trial: 'text-[#D29922]',
    pending: 'text-[#388BFD]',
    suspended: 'text-[#F85149]',
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-[#E6EDF3] mb-2">Panel de administración</h1>
      <p className="text-sm text-[#7D8590] mb-6">{users.length} usuarios registrados</p>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-[#161B22] border border-[#21262D] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-[#161B22] border border-[#21262D] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#21262D]">
                    {['Nombre', 'Email', 'Plan', 'Estado', 'Trial', 'Creado', 'Acciones'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-[#7D8590] uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#21262D]">
                  {users.map((user) => (
                    <tr key={user.userId} className="hover:bg-[#21262D]/50 transition-colors">
                      <td className="px-4 py-3 text-[#E6EDF3] whitespace-nowrap">{user.name}</td>
                      <td className="px-4 py-3 text-[#7D8590] font-mono text-xs">{user.email}</td>
                      <td className="px-4 py-3">
                        {editing === user.userId ? (
                          <select
                            defaultValue={user.plan}
                            onChange={(e) =>
                              updateUser.mutate({ userId: user.userId, data: { plan: e.target.value as Plan } })
                            }
                            className="bg-[#0D1117] border border-[#21262D] text-[#E6EDF3] text-xs rounded px-2 py-1 focus:outline-none"
                          >
                            {PLAN_OPTIONS.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-mono text-xs font-bold text-[#388BFD] uppercase">{user.plan}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editing === user.userId ? (
                          <select
                            defaultValue={user.status}
                            onChange={(e) =>
                              updateUser.mutate({ userId: user.userId, data: { status: e.target.value as UserStatus } })
                            }
                            className="bg-[#0D1117] border border-[#21262D] text-[#E6EDF3] text-xs rounded px-2 py-1 focus:outline-none"
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={`text-xs font-medium ${statusColor[user.status]}`}>
                            {user.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-[#7D8590] whitespace-nowrap">
                        {user.trialEndsAt ? formatDate(user.trialEndsAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-[#7D8590] whitespace-nowrap">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditing(editing === user.userId ? null : user.userId)}
                            className="text-xs text-[#388BFD] hover:text-[#58A6FF] transition-colors"
                          >
                            {editing === user.userId ? 'Listo' : 'Editar'}
                          </button>
                          {user.status !== 'active' && (
                            <button
                              onClick={() =>
                                updateUser.mutate({
                                  userId: user.userId,
                                  data: {
                                    status: 'active',
                                    subscriptionStart: new Date().toISOString(),
                                    subscriptionEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
                                  },
                                })
                              }
                              disabled={updateUser.isPending}
                              className="text-xs text-[#2EA043] hover:text-[#3FB950] disabled:opacity-50 transition-colors"
                            >
                              Activar
                            </button>
                          )}
                          {user.status === 'active' && (
                            <button
                              onClick={() =>
                                updateUser.mutate({ userId: user.userId, data: { status: 'suspended' } })
                              }
                              disabled={updateUser.isPending}
                              className="text-xs text-[#F85149] hover:text-[#FF7B72] disabled:opacity-50 transition-colors"
                            >
                              Suspender
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-3">
            {users.map((user) => (
              <div key={user.userId} className="bg-[#161B22] border border-[#21262D] rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-[#E6EDF3]">{user.name}</p>
                    <p className="text-xs font-mono text-[#7D8590] break-all">{user.email}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-mono text-xs font-bold text-[#388BFD] uppercase">{user.plan}</span>
                    <span className={`text-xs font-medium ${statusColor[user.status]}`}>{user.status}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-[#7D8590] mb-3">
                  <span>Trial: {user.trialEndsAt ? formatDate(user.trialEndsAt) : '—'}</span>
                  <span>Reg: {formatDate(user.createdAt)}</span>
                </div>
                {editing === user.userId && (
                  <div className="flex gap-2 mb-3">
                    <select
                      defaultValue={user.plan}
                      onChange={(e) =>
                        updateUser.mutate({ userId: user.userId, data: { plan: e.target.value as Plan } })
                      }
                      className="flex-1 bg-[#0D1117] border border-[#21262D] text-[#E6EDF3] text-xs rounded px-2 py-1.5 focus:outline-none"
                    >
                      {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select
                      defaultValue={user.status}
                      onChange={(e) =>
                        updateUser.mutate({ userId: user.userId, data: { status: e.target.value as UserStatus } })
                      }
                      className="flex-1 bg-[#0D1117] border border-[#21262D] text-[#E6EDF3] text-xs rounded px-2 py-1.5 focus:outline-none"
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setEditing(editing === user.userId ? null : user.userId)}
                    className="text-xs text-[#388BFD] hover:text-[#58A6FF] transition-colors"
                  >
                    {editing === user.userId ? 'Listo' : 'Editar'}
                  </button>
                  {user.status !== 'active' && (
                    <button
                      onClick={() =>
                        updateUser.mutate({
                          userId: user.userId,
                          data: {
                            status: 'active',
                            subscriptionStart: new Date().toISOString(),
                            subscriptionEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
                          },
                        })
                      }
                      disabled={updateUser.isPending}
                      className="text-xs text-[#2EA043] hover:text-[#3FB950] disabled:opacity-50 transition-colors"
                    >
                      Activar
                    </button>
                  )}
                  {user.status === 'active' && (
                    <button
                      onClick={() =>
                        updateUser.mutate({ userId: user.userId, data: { status: 'suspended' } })
                      }
                      disabled={updateUser.isPending}
                      className="text-xs text-[#F85149] hover:text-[#FF7B72] disabled:opacity-50 transition-colors"
                    >
                      Suspender
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function Admin() {
  const { isAdmin } = { isAdmin: true } // AuthStore check is done in the route guard
  return isAdmin ? <AdminContent /> : <PlanGate requiredPlan="pro"><></></PlanGate>
}
