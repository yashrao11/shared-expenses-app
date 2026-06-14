'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Users, CreditCard, BarChart2, ListFilter, 
  PlusCircle, RefreshCw, Send, ShieldCheck, UserCheck,
  AlertTriangle, X, Home
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

  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);

  const [groupName, setGroupName] = useState('Flatmates Shared Space');
  const [balances, setBalances] = useState<MemberBalance[]>([]);
  const [simplifiedDebts, setSimplifiedDebts] = useState<SimplifiedDebt[]>([]);
  const [selectedLedgerUserId, setSelectedLedgerUserId] = useState('');
  const [ledger, setLedger] = useState<LedgerItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [isExpenseDrawerOpen, setIsExpenseDrawerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [settlePayerId, setSettlePayerId] = useState('');
  const [settlePayeeId, setSettlePayeeId] = useState('');
  const [settleAmount, setSettleAmount] = useState('');
  const [settleDate, setSettleDate] = useState('');
  const [submittingSettle, setSubmittingSettle] = useState(false);

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
    const savedId = localStorage.getItem('userId');
    const savedName = localStorage.getItem('userName');
    if (!savedId || !savedName) {
      router.push('/');
      return;
    }
    setCurrentUser({ id: savedId, name: savedName });
    setSelectedLedgerUserId(savedId);

    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => { if (data.success) setUsers(data.users); })
      .catch((e) => console.error(e));

    fetchBalances();
  }, [groupId, router]);

  useEffect(() => {
    if (selectedLedgerUserId) fetchLedger(selectedLedgerUserId);
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
    } catch {
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
      if (data.success) setLedger(data.ledger);
    } catch {
      console.error('Ledger fetch error');
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
    } catch {
      setErrorMessage('Network error creating settlement.');
    } finally {
      setSubmittingSettle(false);
    }
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseDesc || !expenseAmount || !expenseSplitType || expenseSplitWith.length === 0) {
      alert('Please fill out description, amount, split type, and select at least one participant.');
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
    } catch {
      setErrorMessage('Network error creating expense.');
    } finally {
      setSubmittingExpense(false);
    }
  };

  const toggleParticipant = (name: string) => {
    setExpenseSplitWith(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  // Input class reused in forms
  const inputCls = 'w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 text-xs transition-colors';
  const labelCls = 'text-slate-600 block font-semibold mb-1';

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-800 font-sans">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Home className="w-4 h-4 text-indigo-600" />
              <h1 className="font-bold text-slate-900 truncate hidden md:block">{groupName}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-1 justify-end sm:flex-none">
            <Link
              href="/import"
              className="text-xs sm:text-sm bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium px-4 py-2 rounded-xl border border-slate-200 transition-colors"
            >
              CSV Console
            </Link>

            {currentUser && (
              <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 text-xs">
                <UserCheck className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
                <span className="text-slate-500 font-medium hidden sm:inline">Viewing as:</span>
                <select
                  value={currentUser.id}
                  onChange={handleIdentityChange}
                  className="bg-transparent border-none text-indigo-600 font-semibold focus:outline-none cursor-pointer pr-1"
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-8">

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-500" />
            <span className="text-sm">{errorMessage}</span>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-400 text-sm">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
            Calculating balances and debt graph...
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* Left Column */}
            <div className="lg:col-span-2 space-y-8">

              {/* Aggregate Balances */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    Roommate Net Balances
                  </h3>
                  <button onClick={fetchBalances} className="text-slate-400 hover:text-slate-700 transition-colors" title="Refresh">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {balances.map((m) => {
                    const isPositive = m.netBalance >= 0;
                    return (
                      <div key={m.userId} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex justify-between items-center hover:border-slate-300 transition-colors">
                        <div className="space-y-0.5">
                          <span className="font-semibold text-slate-800 text-sm">{m.userName}</span>
                          <div className="text-[10px] text-slate-400 flex gap-2">
                            <span>Paid: ₹{m.totalPaid.toLocaleString()}</span>
                            <span>Owed: ₹{m.totalOwed.toLocaleString()}</span>
                          </div>
                        </div>
                        <span className={`font-bold text-sm px-2.5 py-1 rounded-lg ${isPositive ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                          {isPositive ? '+' : ''}₹{m.netBalance.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Individual Audit Ledger */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
                  <div className="space-y-0.5">
                    <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                      <ListFilter className="w-5 h-5 text-indigo-600" />
                      Individual Audit Ledger
                    </h3>
                    <p className="text-xs text-slate-500">Reconcile aggregates down to individual line item contributions</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 flex-shrink-0">Filter:</span>
                    <select
                      value={selectedLedgerUserId}
                      onChange={(e) => setSelectedLedgerUserId(e.target.value)}
                      className="bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
                    >
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {ledgerLoading ? (
                  <div className="py-20 text-center text-slate-400 text-xs animate-pulse">Loading transaction records...</div>
                ) : ledger.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 text-xs">This user has no transaction history in this group.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-500 uppercase tracking-wider text-[10px]">
                          <th className="py-3 pr-4">Date</th>
                          <th className="py-3 px-4">Description</th>
                          <th className="py-3 px-4 text-right">Total</th>
                          <th className="py-3 px-4 text-right">Owed Share</th>
                          <th className="py-3 pl-4 text-right">Net Impact</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {ledger.map((item) => {
                          const isPositive = item.myNetImpact >= 0;
                          return (
                            <tr key={item.expenseId} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-3.5 pr-4 text-slate-500">{new Date(item.date).toLocaleDateString()}</td>
                              <td className="py-3.5 px-4 font-medium text-slate-800">
                                {item.description}
                                {item.wasPaidByMe && (
                                  <span className="ml-2 bg-indigo-50 text-indigo-600 border border-indigo-100 text-[9px] px-1.5 py-0.5 rounded font-semibold">I Paid</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-right text-slate-600">₹{item.totalAmount.toLocaleString()}</td>
                              <td className="py-3.5 px-4 text-right text-slate-500">₹{item.myOwedShare.toLocaleString()}</td>
                              <td className={`py-3.5 pl-4 text-right font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
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

            {/* Right Column */}
            <div className="space-y-6">

              {/* Quick Actions */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                <h3 className="font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-indigo-600" />
                  Quick Actions
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={() => {
                      setSettlePayerId(currentUser?.id || '');
                      setIsSettleModalOpen(true);
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold py-3 rounded-2xl transition-all shadow-md shadow-indigo-600/10 cursor-pointer"
                  >
                    <Send className="w-4 h-4" /> Record Cash Payback
                  </button>

                  <button
                    onClick={() => setIsExpenseDrawerOpen(true)}
                    className="w-full inline-flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-sm font-semibold py-3 rounded-2xl transition-all cursor-pointer"
                  >
                    <PlusCircle className="w-4 h-4 text-indigo-600" /> Add Manual Expense
                  </button>
                </div>
              </div>

              {/* Simplified Settlements */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                <h3 className="font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
                  <BarChart2 className="w-5 h-5 text-indigo-600" />
                  Simplified Settlements
                </h3>

                {simplifiedDebts.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-2 bg-slate-50">
                    <ShieldCheck className="w-6 h-6 text-emerald-500" />
                    <span>All balances settled. No payments due.</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {simplifiedDebts.map((d, index) => (
                      <div key={index} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col gap-1.5 hover:border-slate-300 transition-colors">
                        <div className="text-xs text-slate-400 flex justify-between items-center">
                          <span>Transfer #{index + 1}</span>
                          <span className="font-bold text-indigo-600">₹{d.amount.toLocaleString()}</span>
                        </div>
                        <div className="text-sm font-medium text-slate-700">
                          <span className="text-red-500 font-semibold">{d.fromUserName}</span>
                          <span className="text-slate-400 mx-1.5">→</span>
                          <span className="text-emerald-600 font-semibold">{d.toUserName}</span>
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

      {/* MODAL: Settle Debt */}
      {isSettleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 space-y-5 shadow-2xl relative">
            <button
              onClick={() => setIsSettleModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h4 className="font-bold text-lg text-slate-900">Record Cash Payback</h4>
              <p className="text-xs text-slate-500">Direct roommate settlements are immediately reconciled in the ledger.</p>
            </div>

            <form onSubmit={handleSettleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Payer (Who Paid):</label>
                  <select value={settlePayerId} onChange={(e) => setSettlePayerId(e.target.value)} className={inputCls}>
                    <option value="">Select Roommate</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Payee (Who Received):</label>
                  <select value={settlePayeeId} onChange={(e) => setSettlePayeeId(e.target.value)} className={inputCls}>
                    <option value="">Select Roommate</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>Amount (₹ INR):</label>
                <input type="number" step="0.01" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} placeholder="0.00" className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Settlement Date:</label>
                <input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} className={inputCls} />
              </div>

              <button
                type="submit"
                disabled={submittingSettle}
                className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold py-3 rounded-2xl transition-all shadow-md shadow-indigo-600/10 cursor-pointer text-sm"
              >
                {submittingSettle ? 'Recording...' : 'Record Settlement'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* DRAWER: New Expense */}
      {isExpenseDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border-l border-slate-200 w-full max-w-md p-6 h-full overflow-y-auto space-y-6 shadow-2xl relative">
            <button
              onClick={() => setIsExpenseDrawerOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h4 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-indigo-600" />
                Add New Expense
              </h4>
              <p className="text-xs text-slate-500">Payer is set to: <span className="font-semibold text-indigo-600">{currentUser?.name}</span></p>
            </div>

            <form onSubmit={handleExpenseSubmit} className="space-y-5 text-xs">
              <div>
                <label className={labelCls}>Description:</label>
                <input type="text" required value={expenseDesc} onChange={(e) => setExpenseDesc(e.target.value)} placeholder="e.g. Pizza Night, Wifi bill" className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Amount:</label>
                  <input type="number" step="0.01" required value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} placeholder="0.00" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Currency:</label>
                  <select value={expenseCurrency} onChange={(e) => setExpenseCurrency(e.target.value)} className={inputCls}>
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>Split Type:</label>
                <select value={expenseSplitType} onChange={(e) => setExpenseSplitType(e.target.value)} className={inputCls}>
                  <option value="equal">Equal</option>
                  <option value="unequal">Unequal (Amounts)</option>
                  <option value="percentage">Percentage (%)</option>
                  <option value="share">Share (Ratios)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className={labelCls}>Split With (Select participants):</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 border border-slate-200 rounded-2xl">
                  {users.map(u => {
                    const checked = expenseSplitWith.includes(u.name);
                    return (
                      <label key={u.id} className="flex items-center gap-2 p-1.5 cursor-pointer hover:text-indigo-600 transition-colors rounded-lg">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleParticipant(u.name)}
                          className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 border-slate-300"
                        />
                        <span className="font-medium text-slate-700 text-xs">{u.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {expenseSplitType !== 'equal' && (
                <div>
                  <label className={labelCls}>Split Details:</label>
                  <input
                    type="text"
                    required
                    value={expenseSplitDetails}
                    onChange={(e) => setExpenseSplitDetails(e.target.value)}
                    placeholder={
                      expenseSplitType === 'percentage' ? 'Aisha 30%; Rohan 30%; Priya 40%'
                        : expenseSplitType === 'share' ? 'Aisha 1; Rohan 2; Priya 1'
                          : 'Rohan 500; Priya 300'
                    }
                    className={`${inputCls} font-mono`}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Date:</label>
                  <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Notes (Optional):</label>
                  <input type="text" value={expenseNotes} onChange={(e) => setExpenseNotes(e.target.value)} placeholder="Extra details..." className={inputCls} />
                </div>
              </div>

              <button
                type="submit"
                disabled={submittingExpense}
                className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold py-3.5 rounded-2xl transition-all shadow-md shadow-indigo-600/10 cursor-pointer text-sm"
              >
                {submittingExpense ? 'Creating...' : 'Create Expense'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-slate-400 text-xs mt-12">
        <p>© 2026 SplitSmart Roommate Settlement Engine. Built for Spreetail.</p>
      </footer>
    </div>
  );
}
