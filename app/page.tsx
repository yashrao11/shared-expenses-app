'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { User, ShieldAlert, ArrowRight, UserCheck, Home } from 'lucide-react';

interface UserItem {
  id: string;
  name: string;
}

interface GroupItem {
  id: string;
  name: string;
  createdAt: string;
}

export default function LandingPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [usersRes, groupsRes] = await Promise.all([
          fetch('/api/users').then((r) => r.json()),
          fetch('/api/groups').then((r) => r.json()),
        ]);

        if (usersRes.success) setUsers(usersRes.users);
        if (groupsRes.success) setGroups(groupsRes.groups);

        // Load logged in user from localStorage if any
        const savedId = localStorage.getItem('userId');
        const savedName = localStorage.getItem('userName');
        if (savedId && savedName) {
          setCurrentUser({ id: savedId, name: savedName });
        }
      } catch (err) {
        console.error('Error fetching landing data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleSelectUser = (user: UserItem) => {
    localStorage.setItem('userId', user.id);
    localStorage.setItem('userName', user.name);
    setCurrentUser({ id: user.id, name: user.name });
  };

  const handleLogout = () => {
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
    setCurrentUser(null);
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-indigo-600 selection:text-white">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Home className="w-6 h-6 text-indigo-600" />
            <span className="font-semibold text-lg tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              SplitSmart
            </span>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/import"
              className="text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              CSV Import Console
            </Link>
            {currentUser && (
              <div className="flex items-center gap-3 bg-slate-100 border border-slate-200 rounded-full py-1 pl-3 pr-2 text-xs sm:text-sm">
                <span className="text-indigo-700 font-medium">{currentUser.name}</span>
                <button
                  onClick={handleLogout}
                  className="bg-slate-200 hover:bg-slate-300 px-2 py-0.5 rounded-full transition-colors text-slate-600 text-xs font-semibold"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-4xl mx-auto px-6 py-12 w-full flex flex-col justify-center gap-12">
        {/* Intro */}
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
            Shared Roommate Expenses{' '}
            <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              Simplified.
            </span>
          </h1>
          <p className="text-slate-600 text-base md:text-lg">
            Track flatmate expenses, resolve raw CSV import anomalies, and settle balances with optimized cash transfers.
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-slate-500 text-sm">Initializing SplitSmart portal...</span>
          </div>
        ) : (
          <div className="space-y-12">
            {/* Roommate Simulated Login Grid */}
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <User className="w-5 h-5 text-indigo-600" />
                  1. Choose Your Roommate Profile (Simulated Auth)
                </h2>
                {currentUser ? (
                  <span className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1.5 font-semibold">
                    <UserCheck className="w-3.5 h-3.5" />
                    Active: {currentUser.name}
                  </span>
                ) : (
                  <span className="text-xs bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full border border-amber-200 flex items-center gap-1.5 font-semibold">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Authentication Required
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {users.map((user) => {
                  const isSelected = currentUser?.id === user.id;
                  return (
                    <button
                      key={user.id}
                      onClick={() => handleSelectUser(user)}
                      className={`relative flex flex-col items-center justify-center p-6 rounded-2xl border text-center transition-all duration-300 transform hover:-translate-y-1 cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-500 shadow-md shadow-indigo-500/5 scale-105 ring-2 ring-indigo-500/20'
                          : 'bg-white hover:bg-slate-50 border-slate-200/80 hover:border-slate-300 shadow-sm'
                      }`}
                    >
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors ${
                          isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <span className="font-bold text-lg">{user.name[0]}</span>
                      </div>
                      <span className="font-semibold text-slate-900">{user.name}</span>
                      <span className="text-xs text-slate-500 mt-1">
                        {user.name === 'Dev' ? 'Visiting Friend' : 'Roommate'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Groups List */}
            <div className="space-y-6">
              <div className="border-b border-slate-200 pb-3">
                <h2 className="text-xl font-bold text-slate-800">
                  2. Select Shared Space Group
                </h2>
              </div>

              {groups.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500">
                  No groups created. Ensure the seed script has initialized.
                </div>
              ) : (
                <div className="space-y-4">
                  {groups.map((group) => {
                    const canEnter = currentUser !== null;
                    return (
                      <div
                        key={group.id}
                        className={`group relative flex flex-col sm:flex-row sm:items-center justify-between p-6 rounded-2xl border transition-all duration-300 ${
                          canEnter
                            ? 'bg-white border-slate-200 hover:border-slate-300 hover:bg-white/90 shadow-sm'
                            : 'bg-white/50 border-slate-100 cursor-not-allowed opacity-60'
                        }`}
                      >
                        <div className="space-y-1">
                          <h3 className="font-bold text-lg text-slate-950 group-hover:text-indigo-600 transition-colors">
                            {group.name}
                          </h3>
                          <p className="text-xs text-slate-500">
                            Active since {new Date(group.createdAt).toLocaleDateString()}
                          </p>
                        </div>

                        {canEnter ? (
                          <Link
                            href={`/groups/${group.id}`}
                            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-all self-start sm:self-auto shadow-md shadow-indigo-600/10 mt-4 sm:mt-0 cursor-pointer"
                          >
                            Enter Dashboard
                            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                          </Link>
                        ) : (
                          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl mt-4 sm:mt-0 flex items-center gap-1.5 self-start sm:self-auto font-semibold">
                            <ShieldAlert className="w-4 h-4 text-amber-600" />
                            Select Roommate Profile to Enter
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-slate-500 text-xs mt-12">
        <p>© 2026 SplitSmart Roommate Settlement Engine. Built for Spreetail.</p>
      </footer>
    </div>
  );
}}
