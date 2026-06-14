'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Users, CreditCard, DollarSign, ListFilter, 
  PlusCircle, RefreshCw, Send, ShieldCheck, UserCheck,
  AlertTriangle, X
} from 'lucide-react';

interface MemberBalance {
  userId: string;
  userName: string;
  totalPaid: number;
  totalOwed: number;
  netBalance: number;
}

interface SimplifiedDebt {
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  amount: number;
}

interface LedgerItem {
  expenseId: string;
  description: string;
  date: string;
  wasPaidByMe: boolean;
  totalAmount: number;
  myOwedShare: number;
  myNetImpact: number;
}

interface UserItem {
  id: string;
  name: string;
}

export default function GroupDashboard({ params }: { params: Promise<{ groupId: string }> }) {
  const router = useRouter();
  const { groupId } = use(params);

  // Auth simulated state
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);

  // Page data states
  const [groupName, setGroupName] = useState('Flatmates Shared Space');
  const [balances, setBalances] = useState<MemberBalance[]>([]);
  const [simplifiedDebts, setSimplifiedDebts] = useState<SimplifiedDebt[]>([]);
  const [selectedLedgerUserId, setSelectedLedgerUserId] = useState('');
  const [ledger, setLedger] = useState<LedgerItem[]>([]);

  // UI state controllers
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [isExpenseDrawerOpen, setIsExpenseDrawerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Settlement Form state
  const [settlePayerId, setSettlePayerId] = useState('');
  const [settlePayeeId, setSettlePayeeId] = useState('');
  const [settleAmount, setSettleAmount] = useState('');
  const [settleDate, setSettleDate] = useState('');
  const [submittingSettle, setSubmittingSettle] = useState(false);

  // Expense Form state
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCurrency, setExpenseCurrency] = useState('INR');
  const [expenseSplitType, setExpenseSplitType] = useState('equal');
  const [expenseSplitWith, setExpenseSplitWith] = useState<string[]>([]);
  const [expenseSplitDetails, setExpenseSplitDetails] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [expenseNotes, setExpenseNotes] = useState('');
  const [submittingExpense, setSubmittingExpense] = useState(false);

  useEffect(() => {
    // 1. Check logged in status
    const savedId = localStorage.getItem('userId');
    const savedName = localStorage.getItem('userName');
    if (!savedId || !savedName) {
      router.push('/');
      return;
    }
    setCurrentUser({ id: savedId, name: savedName });
    setSelectedLedgerUserId(savedId);

    // 2. Fetch users
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setUsers(data.users);
        }
      })
      .catch((e) => console.error(e));

    // 3. Fetch group details & balances
    fetchBalances();
  }, [groupId, router]);

  useEffect(() => {
    if (selectedLedgerUserId) {
      fetchLedger(selectedLedgerUserId);
    }
  }, [selectedLedgerUserId]);

  const fetchBalances = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/balances`);
      const data = await res.json();
      if (data.success) {
        setBalances(data.balances);
        setSimplifiedDebts(data.simplifiedDebts);
      } else {
        setErrorMessage(data.error || 'Failed to fetch balances.');
      }
    } catch (err) {
      setErrorMessage('Network error fetching balances.');
    } finally {
      setLoading(false);
    }
  };

  const fetchLedger = async (userId: string) => {
    setLedgerLoading(true);
    try {
      const res = await fetch(`/api/ledger?userId=${userId}&groupId=${groupId}`);
      const data = await res.json();
      if (data.success) {
        setLedger(data.ledger);
      }
    } catch (err) {
      console.error('Error fetching ledger:', err);
    } finally {
      setLedgerLoading(false);
    }
  };

  const handleIdentityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const userId = e.target.value;
    const matched = users.find(u => u.id === userId);
    if (matched) {
      localStorage.setItem('userId', matched.id);
      localStorage.setItem('userName', matched.name);
      setCurrentUser({ id: matched.id, name: matched.name });
      setSelectedLedgerUserId(matched.id);
    }
  };

  const handleSettleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlePayerId || !settlePayeeId || !settleAmount) {
      alert('Please fill out all settlement fields.');
      return;
    }
    if (settlePayerId === settlePayeeId) {
      alert('Payer and payee cannot be the same roommate.');
      return;
    }

    setSubmittingSettle(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          payerId: settlePayerId,
          payeeId: settlePayeeId,
          amount: parseFloat(settleAmount),
          date: settleDate || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsSettleModalOpen(false);
        setSettlePayerId('');
        setSettlePayeeId('');
        setSettleAmount('');
        setSettleDate('');
        await fetchBalances();
        if (selectedLedgerUserId) await fetchLedger(selectedLedgerUserId);
      } else {
        setErrorMessage(data.error || 'Failed to record settlement.');
      }
    } catch (err) {
      setErrorMessage('Network error creating settlement transaction.');
    } finally {
      setSubmittingSettle(false);
    }
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseDesc || !expenseAmount || !expenseSplitType || expenseSplitWith.length === 0) {
      alert('Please fill out description, amount, split type, and check at least one participant.');
      return;
    }

    setSubmittingExpense(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          paidById: currentUser?.id,
          description: expenseDesc,
          amount: parseFloat(expenseAmount),
          currency: expenseCurrency,
          splitType: expenseSplitType,
          splitWith: expenseSplitWith,
          splitDetails: expenseSplitDetails || undefined,
          date: expenseDate || undefined,
          notes: expenseNotes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsExpenseDrawerOpen(false);
        setExpenseDesc('');
        setExpenseAmount('');
        setExpenseCurrency('INR');
        setExpenseSplitType('equal');
        setExpenseSplitWith([]);
        setExpenseSplitDetails('');
        setExpenseDate('');
        setExpenseNotes('');
        await fetchBalances();
        if (selectedLedgerUserId) await fetchLedger(selectedLedgerUserId);
      } else {
        setErrorMessage(data.error || 'Failed to create expense.');
      }
    } catch (err) {
      setErrorMessage('Network error creating manual expense.');
    } finally {
      setSubmittingExpense(false);
    }
  };

  const toggleParticipant = (name: string) => {
    if (expenseSplitWith.includes(name)) {
      setExpenseSplitWith(expenseSplitWith.filter(n => n !== name));
    } else {
      setExpenseSplitWith([...expenseSplitWith, name]);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="font-bold text-slate-100 truncate hidden md:block">{groupName}</h1>
          </div>

          <div className="flex items-center gap-4 flex-1 justify-end sm:flex-none">
            <Link
              href="/import"
              className="text-xs sm:text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium px-4 py-2 rounded-xl border border-slate-700/50 transition-colors"
            >
              CSV Console
            </Link>
            
            {/* Identity Switcher */}
            {currentUser && (
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-700/50 rounded-xl px-2.5 py-1 text-xs">
                <span className="text-slate-400 font-medium hidden sm:inline flex-shrink-0">Logged in:</span>
                <select
                  value={currentUser.id}
                  onChange={handleIdentityChange}
                  className="bg-transparent border-none text-indigo-400 font-semibold focus:outline-none cursor-pointer pr-1"
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id} className="bg-slate-900 text-slate-200">{u.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-8">
        
        {/* Error Notification */}
        {errorMessage && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{errorMessage}</span>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-400 text-sm">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
            Analyzing balances and debt graphs...
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Hand side / Roomies Aggregate Balances & Settlements */}
            <div className="lg:col-span-2 space-y-8">
              
              {/* Aggregate Balances Card list */}
              <div className="bg-slate-850 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-400" />
                    Roommate Aggregate Net Balances
                  </h3>
                  <button onClick={fetchBalances} className="text-slate-400 hover:text-white transition-colors">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {balances.map((m) => {
                    const isPositive = m.netBalance >= 0;
                    return (
                      <div key={m.userId} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex justify-between items-center">
                        <div className="space-y-0.5">
                          <span className="font-semibold text-slate-200 text-sm">{m.userName}</span>
                          <div className="text-[10px] text-slate-500 flex gap-2">
                            <span>Paid: ₹{m.totalPaid.toLocaleString()}</span>
                            <span>Owed: ₹{m.totalOwed.toLocaleString()}</span>
                          </div>
                        </div>
                        <span className={`font-bold text-sm ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isPositive ? '+' : ''}₹{m.netBalance.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Section B: Selected Roommate Ledger Details */}
              <div className="bg-slate-850 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-3">
                  <div className="space-y-0.5">
                    <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                      <ListFilter className="w-5 h-5 text-indigo-400" />
                      Individual Audit Ledger
                    </h3>
                    <p className="text-xs text-slate-400">Reconcile aggregates down to individual line item contributions</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 flex-shrink-0">Filter Member:</span>
                    <select
                      value={selectedLedgerUserId}
                      onChange={(e) => setSelectedLedgerUserId(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
                    >
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {ledgerLoading ? (
                  <div className="py-20 text-center text-slate-500 text-xs animate-pulse">Loading transaction records...</div>
                ) : ledger.length === 0 ? (
                  <div className="py-16 text-center text-slate-500 text-xs">This user has no transaction history in this group space.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wider text-[10px]">
                          <th className="py-3 pr-4">Date</th>
                          <th className="py-3 px-4">Description</th>
                          <th className="py-3 px-4 text-right">Total Amount</th>
                          <th className="py-3 px-4 text-right">Owed Share</th>
                          <th className="py-3 pl-4 text-right">Net Impact</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850">
                        {ledger.map((item) => {
                          const isPositive = item.myNetImpact >= 0;
                          return (
                            <tr key={item.expenseId} className="hover:bg-slate-900/10 transition-colors">
                              <td className="py-3.5 pr-4 text-slate-400">{new Date(item.date).toLocaleDateString()}</td>
                              <td className="py-3.5 px-4 font-medium text-slate-200">
                                {item.description}
                                {item.wasPaidByMe && (
                                  <span className="ml-2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[9px] px-1.5 py-0.5 rounded font-medium">I Paid</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-right text-slate-300">₹{item.totalAmount.toLocaleString()}</td>
                              <td className="py-3.5 px-4 text-right text-slate-400">₹{item.myOwedShare.toLocaleString()}</td>
                              <td className={`py-3.5 pl-4 text-right font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isPositive ? '+' : ''}₹{item.myNetImpact.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>

            {/* Right Hand side / Simplified Debts & Quick Actions Panel */}
            <div className="space-y-8">
              
              {/* Quick Actions Card */}
              <div className="bg-slate-850 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
                <h3 className="font-bold text-slate-100 border-b border-slate-800 pb-2 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-indigo-400" />
                  Quick Actions
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {/* Settle Debt Button */}
                  <button
                    onClick={() => {
                      setSettlePayerId(currentUser?.id || '');
                      setIsSettleModalOpen(true);
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-3 rounded-2xl transition-all shadow-md shadow-indigo-600/15 cursor-pointer"
                  >
                    <Send className="w-4 h-4" /> Record Cash Payback
                  </button>

                  {/* Add Expense Button */}
                  <button
                    onClick={() => setIsExpenseDrawerOpen(true)}
                    className="w-full inline-flex items-center justify-center gap-2 bg-slate-855 hover:bg-slate-800 text-slate-200 border border-slate-700/80 text-sm font-semibold py-3 rounded-2xl transition-all cursor-pointer"
                  >
                    <PlusCircle className="w-4 h-4 text-indigo-400" /> Add Manual Expense
                  </button>
                </div>
              </div>

              {/* Section A: Aisha's Simplified Debts ("Who Pays Whom") */}
              <div className="bg-slate-850 border border-slate-800 rounded-3xl p-6 shadow-lg space-y-4">
                <h3 className="font-bold text-slate-100 border-b border-slate-800 pb-2 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-indigo-400" />
                  Simplified Settlements
                </h3>

                {simplifiedDebts.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs border border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-2 bg-slate-900/30">
                    <ShieldCheck className="w-6 h-6 text-emerald-400" />
                    <span>All balances are settled! No payments due.</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {simplifiedDebts.map((d, index) => (
                      <div key={index} className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-2 relative">
                        <div className="text-xs text-slate-400 flex justify-between items-center">
                          <span>Transfer #{index + 1}</span>
                          <span className="font-semibold text-indigo-300">₹{d.amount.toLocaleString()}</span>
                        </div>
                        <div className="text-sm font-medium text-slate-200">
                          <span className="text-red-400">{d.fromUserName}</span> owes <span className="text-emerald-400">{d.toUserName}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

          </div>
        )}
      </main>

      {/* MODAL: Settle Debt Form */}
      {isSettleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-850 border border-slate-800 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setIsSettleModalOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h4 className="font-bold text-lg text-white">Record Cash Payback</h4>
              <p className="text-xs text-slate-400">Direct roommate settlements are immediately reconciled as 0-owed balances.</p>
            </div>

            <form onSubmit={handleSettleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-slate-400 block font-semibold">Payer (Who Paid):</label>
                  <select
                    value={settlePayerId}
                    onChange={(e) => setSettlePayerId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500"
                  >
                    <option value="">Select Roommate</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 block font-semibold">Payee (Who Received):</label>
                  <select
                    value={settlePayeeId}
                    onChange={(e) => setSettlePayeeId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500"
                  >
                    <option value="">Select Roommate</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 block font-semibold">Amount (₹ INR):</label>
                <input
                  type="number"
                  step="0.01"
                  value={settleAmount}
                  onChange={(e) => setSettleAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 block font-semibold">Settlement Date:</label>
                <input
                  type="date"
                  value={settleDate}
                  onChange={(e) => setSettleDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={submittingSettle}
                className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-semibold py-3 rounded-2xl transition-all shadow-md shadow-indigo-600/10 cursor-pointer text-sm"
              >
                {submittingSettle ? 'Recording...' : 'Record Settle Payment'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* DRAWER: New Expense Creator Form */}
      {isExpenseDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-850 border-l border-slate-800 w-full max-w-md p-6 h-full overflow-y-auto space-y-6 shadow-2xl relative animate-slide-left">
            <button
              onClick={() => setIsExpenseDrawerOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h4 className="font-bold text-lg text-white flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-indigo-400" />
                Add New Expense
              </h4>
              <p className="text-xs text-slate-400">Payer is set to active user ({currentUser?.name}).</p>
            </div>

            <form onSubmit={handleExpenseSubmit} className="space-y-5 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 block font-semibold">Description:</label>
                <input
                  type="text"
                  required
                  value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  placeholder="e.g. Pizza Night, Wifi bill"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-slate-400 block font-semibold">Amount:</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 block font-semibold">Currency:</label>
                  <select
                    value={expenseCurrency}
                    onChange={(e) => setExpenseCurrency(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500 text-xs"
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 block font-semibold">Split Type:</label>
                <select
                  value={expenseSplitType}
                  onChange={(e) => setExpenseSplitType(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500 text-xs"
                >
                  <option value="equal">Equal</option>
                  <option value="unequal">Unequal (Amounts)</option>
                  <option value="percentage">Percentage (%)</option>
                  <option value="share">Share (Ratios)</option>
                </select>
              </div>

              {/* Split With checklist */}
              <div className="space-y-2">
                <label className="text-slate-400 block font-semibold">Split With (Select participants):</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-900/60 p-3 border border-slate-800 rounded-2xl">
                  {users.map(u => {
                    const checked = expenseSplitWith.includes(u.name);
                    return (
                      <label key={u.id} className="flex items-center gap-2 p-1.5 cursor-pointer hover:text-indigo-400 transition-colors">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleParticipant(u.name)}
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 border-slate-700 bg-slate-800"
                        />
                        <span className="font-medium text-slate-300 text-xs">{u.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {expenseSplitType !== 'equal' && (
                <div className="space-y-1">
                  <label className="text-slate-400 block font-semibold">Split Details (e.g. details separated by semicolons):</label>
                  <input
                    type="text"
                    required
                    value={expenseSplitDetails}
                    onChange={(e) => setExpenseSplitDetails(e.target.value)}
                    placeholder={
                      expenseSplitType === 'percentage'
                        ? 'Aisha 30%; Rohan 30%; Priya 40%'
                        : expenseSplitType === 'share'
                          ? 'Aisha 1; Rohan 2; Priya 1'
                          : 'Rohan 500; Priya 300'
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 font-mono outline-none focus:border-indigo-500 text-xs"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-slate-400 block font-semibold">Expense Date:</label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 block font-semibold">Notes (Optional):</label>
                  <input
                    type="text"
                    value={expenseNotes}
                    onChange={(e) => setExpenseNotes(e.target.value)}
                    placeholder="Extra details..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 outline-none focus:border-indigo-500 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submittingExpense}
                className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-semibold py-3.5 rounded-2xl transition-all shadow-md shadow-indigo-600/10 cursor-pointer text-sm"
              >
                {submittingExpense ? 'Creating...' : 'Create Expense'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/50 bg-slate-950 py-8 text-center text-slate-500 text-xs mt-12">
        <p>© 2026 SplitSmart Roommate Settlement Engine. Built for Spreetail.</p>
      </footer>
    </div>
  );
}
