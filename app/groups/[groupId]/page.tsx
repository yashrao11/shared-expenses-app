'use client';

import { useEffect, useState, use, Fragment, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Users, CreditCard, BarChart2, ListFilter, 
  PlusCircle, RefreshCw, Send, ShieldCheck, UserCheck,
  AlertTriangle, X, Home, Calendar
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
  const [ledger, setLedger] = useState<any[]>([]);
  const [groupMemberships, setGroupMemberships] = useState<any[]>([]);
  const [expandedLedgerId, setExpandedLedgerId] = useState<string | null>(null);
  const [detailModalItem, setDetailModalItem] = useState<{
    type: 'roommate' | 'settlement';
    data: any;
  } | null>(null);
  const [modalLedger, setModalLedger] = useState<any[]>([]);
  const [modalLedgerLoading, setModalLedgerLoading] = useState(false);
  const [expandModalDebts, setExpandModalDebts] = useState(false);
  const [expandModalCredits, setExpandModalCredits] = useState(false);
  const [activeTab, setActiveTab] = useState<'balances' | 'monthly'>('balances');
  const [groupLedger, setGroupLedger] = useState<any[]>([]);

  const fetchGroupLedger = async () => {
    try {
      const res = await fetch(`/api/ledger?userId=all&groupId=${groupId}`);
      const data = await res.json();
      if (data.success) {
        setGroupLedger(data.ledger);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openRoommateDetail = async (member: MemberBalance) => {
    setExpandModalDebts(false);
    setExpandModalCredits(false);
    setDetailModalItem({ type: 'roommate', data: member });
    setModalLedgerLoading(true);
    try {
      const res = await fetch(`/api/ledger?userId=${member.userId}&groupId=${groupId}`);
      const data = await res.json();
      if (data.success) {
        setModalLedger(data.ledger);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setModalLedgerLoading(false);
    }
  };

  const openSettlementDetail = async (settlement: SimplifiedDebt) => {
    setExpandModalDebts(false);
    setExpandModalCredits(false);
    setDetailModalItem({ type: 'settlement', data: settlement });
    setModalLedgerLoading(true);
    try {
      const res = await fetch(`/api/ledger?userId=${settlement.fromUserId}&groupId=${groupId}`);
      const data = await res.json();
      if (data.success) {
        setModalLedger(data.ledger);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setModalLedgerLoading(false);
    }
  };

  const monthlyBreakdown = useMemo(() => {
    const months: Record<string, {
      monthKey: string;
      totalSpend: number;
      members: Record<string, { paid: number; owed: number }>;
    }> = {};

    for (const exp of groupLedger) {
      const date = new Date(exp.date);
      if (isNaN(date.getTime())) continue;

      const monthName = date.toLocaleString('default', { month: 'long', year: 'numeric' });

      if (!months[monthName]) {
        months[monthName] = {
          monthKey: monthName,
          totalSpend: 0,
          members: {}
        };
        for (const u of users) {
          months[monthName].members[u.name] = { paid: 0, owed: 0 };
        }
      }

      if (!exp.isSettlement) {
        months[monthName].totalSpend += exp.totalAmount;

        const payerName = exp.paidByUserName;
        if (months[monthName].members[payerName]) {
          months[monthName].members[payerName].paid += exp.totalAmount;
        }

        for (const s of exp.allSplits || []) {
          if (months[monthName].members[s.userName]) {
            months[monthName].members[s.userName].owed += s.owedAmount;
          }
        }
      }
    }

    return Object.values(months).sort((a, b) => {
      const dateA = new Date(a.monthKey);
      const dateB = new Date(b.monthKey);
      return dateB.getTime() - dateA.getTime();
    });
  }, [groupLedger, users]);

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

    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => { if (data.success) setUsers(data.users); })
      .catch((e) => console.error(e));

    fetchBalances();
  }, [groupId, router]);

  useEffect(() => {
    if (currentUser?.id) {
      fetchLedger(currentUser.id);
    }
  }, [currentUser?.id]);

  const fetchBalances = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/balances`);
      const data = await res.json();
      if (data.success) {
        setBalances(data.balances);
        setSimplifiedDebts(data.simplifiedDebts);
        if (data.memberships) setGroupMemberships(data.memberships);
        await fetchGroupLedger();
      } else {
        // Heal group not found errors (e.g. after database seeding) by redirecting to a valid group
        if (data.error && data.error.includes('not found')) {
          const groupsRes = await fetch('/api/groups').then((r) => r.json());
          if (groupsRes.success && groupsRes.groups?.length > 0) {
            router.replace(`/groups/${groupsRes.groups[0].id}`);
            return;
          }
        }
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

  const getTimelineExplanation = (name: string, dateStr: string) => {
    const expDate = new Date(dateStr);
    const m = groupMemberships.find((mem) => mem.user.name === name);
    if (!m) return "";
    const joined = new Date(m.joinedAt);
    const left = m.leftAt ? new Date(m.leftAt) : null;
    
    if (expDate < joined) {
      return `joined later on ${joined.toLocaleDateString()}`;
    }
    if (left && expDate > left) {
      return `moved out earlier on ${left.toLocaleDateString()}`;
    }
    return "";
  };

  const handleIdentityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const userId = e.target.value;
    const matched = users.find(u => u.id === userId);
    if (matched) {
      localStorage.setItem('userId', matched.id);
      localStorage.setItem('userName', matched.name);
      setCurrentUser({ id: matched.id, name: matched.name });
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
        if (currentUser?.id) await fetchLedger(currentUser.id);
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
        if (currentUser?.id) await fetchLedger(currentUser.id);
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
        {currentUser && (
          <div className="bg-slate-100 border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg select-none">
                {currentUser.name[0]}
              </div>
              <div>
                <span className="text-[10px] text-slate-450 uppercase font-bold tracking-wider block">Active Member Profile</span>
                <h2 className="text-base font-bold text-slate-900 leading-tight">{currentUser.name}</h2>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2.5 items-center w-full md:w-auto">
              <span className="text-xs text-slate-500 font-semibold">Quick switch roommate:</span>
              <div className="flex flex-wrap gap-1.5">
                {users.map((u) => {
                  const isActive = u.id === currentUser.id;
                  return (
                    <button
                      key={u.id}
                      onClick={() => {
                        localStorage.setItem('userId', u.id);
                        localStorage.setItem('userName', u.name);
                        setCurrentUser({ id: u.id, name: u.name });
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                        isActive
                          ? 'bg-indigo-600 text-white border-transparent shadow-xs scale-105'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {u.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-500" />
            <span className="text-sm">{errorMessage}</span>
          </div>
        )}

        {/* Tab Controls */}
        <div className="flex gap-2 border-b border-slate-200 pb-px">
          <button
            onClick={() => setActiveTab('balances')}
            className={`px-4 py-2 text-sm font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'balances'
                ? 'border-indigo-600 text-indigo-600 font-bold border-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-750'
            }`}
          >
            📊 Roommate Dashboard
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`px-4 py-2 text-sm font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'monthly'
                ? 'border-indigo-600 text-indigo-600 font-bold border-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-750'
            }`}
          >
            📅 Monthly Breakdown
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-400 text-sm">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
            Calculating balances and debt graph...
          </div>
        ) : (
          <>
            {activeTab === 'balances' && (
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
                      <div
                        key={m.userId}
                        onClick={() => openRoommateDetail(m)}
                        className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex justify-between items-center hover:border-indigo-200 hover:bg-indigo-50/5 transition-all cursor-pointer hover:scale-[1.01]"
                        title={`Click to view ${m.userName}'s audit breakdown`}
                      >
                        <div className="space-y-0.5">
                          <span className="font-semibold text-slate-800 text-sm block">{m.userName}</span>
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
                    <p className="text-xs text-slate-500">Audit your contributed items and split shares (Click to expand)</p>
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
                          const isExpanded = expandedLedgerId === item.expenseId;
                          return (
                            <Fragment key={item.expenseId}>
                              <tr
                                onClick={() => setExpandedLedgerId(isExpanded ? null : item.expenseId)}
                                className="hover:bg-slate-50/80 transition-colors cursor-pointer select-none"
                              >
                                <td className="py-3.5 pr-4 text-slate-500">{new Date(item.date).toLocaleDateString()}</td>
                                <td className="py-3.5 px-4 font-semibold text-slate-800">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span>{item.description}</span>
                                    {item.wasPaidByMe && (
                                      <span className="bg-indigo-50 text-indigo-600 border border-indigo-150 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">I Paid</span>
                                    )}
                                    {item.isSettlement && (
                                      <span className="bg-emerald-50 text-emerald-600 border border-emerald-150 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Settlement</span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3.5 px-4 text-right text-slate-600">₹{item.totalAmount.toLocaleString()}</td>
                                <td className="py-3.5 px-4 text-right text-slate-500">₹{item.myOwedShare.toLocaleString()}</td>
                                <td className={`py-3.5 pl-4 text-right font-bold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                                  {isPositive ? '+' : ''}₹{item.myNetImpact.toLocaleString()}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-slate-50/40">
                                  <td colSpan={5} className="p-4 border-t border-slate-100/50">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-700">
                                      <div className="space-y-2">
                                        <h5 className="font-bold text-slate-900 border-b border-slate-200/55 pb-1">Transaction Details</h5>
                                        <div className="space-y-1">
                                          <div className="flex justify-between">
                                            <span className="text-slate-500 font-medium">Payer:</span>
                                            <span className="font-bold text-slate-900">{item.paidByUserName}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-slate-500 font-medium">Original Amount:</span>
                                            {item.currency === 'USD' ? (
                                              <span className="font-bold text-indigo-600">
                                                ${item.rawAmount.toFixed(2)} USD (Converted @ ₹{item.exchangeRate}/USD)
                                              </span>
                                            ) : (
                                              <span className="font-semibold text-slate-800">₹{item.totalAmount.toLocaleString()} INR</span>
                                            )}
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-slate-500 font-medium">Split Method:</span>
                                            <span className="font-semibold text-slate-850 capitalize">{item.splitType}</span>
                                          </div>
                                          {item.notes && (
                                            <div className="mt-1 bg-slate-50 border border-slate-150 p-2 rounded-lg text-[10px] text-slate-600 italic">
                                              Notes: {item.notes}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      <div className="space-y-2">
                                        <h5 className="font-bold text-slate-900 border-b border-slate-200/55 pb-1">Roommate Split Shares</h5>
                                        <div className="space-y-1.5">
                                          {item.allSplits.map((split: any) => (
                                            <div key={split.userName} className="flex justify-between items-center bg-white border border-slate-150 p-2 rounded-lg">
                                              <span className="font-semibold text-slate-700">{split.userName}</span>
                                              <span className="font-bold text-slate-900">₹{split.owedAmount.toLocaleString()}</span>
                                            </div>
                                          ))}

                                          {groupMemberships
                                            .filter((m) => !item.allSplits.some((s: any) => s.userName === m.user.name))
                                            .map((m) => {
                                              const exp = getTimelineExplanation(m.user.name, item.date);
                                              if (!exp) return null;
                                              return (
                                                <div key={m.user.name} className="flex justify-between items-center bg-slate-100/40 border border-dashed border-slate-200 p-2 rounded-lg text-slate-450">
                                                  <span className="italic">{m.user.name} ({exp})</span>
                                                  <span className="line-through">₹0</span>
                                                </div>
                                              );
                                            })}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
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

                {currentUser && (() => {
                  const myBalance = balances.find(b => b.userId === currentUser.id);
                  if (!myBalance) return null;
                  const isPositive = myBalance.netBalance >= 0;
                  return (
                    <div
                      onClick={() => openRoommateDetail(myBalance)}
                      className="bg-slate-50 border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/5 transition-all cursor-pointer rounded-2xl p-4 space-y-2 text-xs hover:scale-[1.01]"
                      title="Click to view your complete audit breakdown"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500 font-semibold">Your Net Balance:</span>
                        <span className={`font-bold px-2 py-0.5 rounded ${isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                          {isPositive ? '+' : ''}₹{myBalance.netBalance.toLocaleString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-550 space-y-1 pt-1.5 border-t border-slate-200/60">
                        <div className="flex justify-between">
                          <span>Total you paid:</span>
                          <span className="font-semibold text-slate-700">₹{myBalance.totalPaid.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total you owe:</span>
                          <span className="font-semibold text-slate-700">₹{myBalance.totalOwed.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-3">
                  {balances
                    .filter((b) => b.userId !== currentUser?.id)
                    .map((other, index) => {
                      const peerSummary = (() => {
                        let directDebts = 0;
                        let offsetCredits = 0;
                        for (const exp of groupLedger) {
                          if (exp.paidById === currentUser?.id) {
                            const split = exp.allSplits?.find((s: any) => s.userId === other.userId);
                            if (split) directDebts += split.owedAmount;
                          }
                          if (exp.paidById === other.userId) {
                            const split = exp.allSplits?.find((s: any) => s.userId === currentUser?.id);
                            if (split) offsetCredits += split.owedAmount;
                          }
                        }
                        const net = directDebts - offsetCredits;
                        return { directDebts, offsetCredits, net };
                      })();

                      const isOwed = peerSummary.net >= 0;
                      const displayAmount = Math.abs(peerSummary.net);
                      const hasDebt = displayAmount > 0.01;

                      return (
                        <div
                          key={index}
                          onClick={() =>
                            openSettlementDetail({
                              fromUserId: isOwed ? other.userId : (currentUser?.id || ''),
                              fromUserName: isOwed ? other.userName : (currentUser?.name || ''),
                              toUserId: isOwed ? (currentUser?.id || '') : other.userId,
                              toUserName: isOwed ? (currentUser?.name || '') : other.userName,
                              amount: displayAmount,
                            })
                          }
                          className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col gap-2 hover:border-indigo-250 hover:bg-indigo-50/5 transition-all cursor-pointer hover:scale-[1.01]"
                          title="Click to view peer-to-peer transaction breakdown and payback"
                        >
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-slate-800">{other.userName}</span>
                            <span
                              className={`font-extrabold px-2 py-0.5 rounded-lg text-[11px] ${
                                !hasDebt
                                  ? 'bg-slate-100 text-slate-500'
                                  : isOwed
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-red-50 text-red-600'
                              }`}
                            >
                              {!hasDebt ? '' : isOwed ? '+' : '-'}₹
                              {displayAmount.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 space-y-0.5 border-t border-slate-150 pt-1.5">
                            <div className="flex justify-between">
                              <span>You paid (Direct Debts):</span>
                              <span className="font-semibold text-slate-700">
                                ₹{peerSummary.directDebts.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>{other.userName} paid (Offset Credits):</span>
                              <span className="font-semibold text-slate-700">
                                ₹{peerSummary.offsetCredits.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                          </div>
                          <div className="text-[10px] text-indigo-700 font-semibold italic mt-0.5 text-right">
                            {!hasDebt ? 'Fully settled' : isOwed ? `${other.userName} owes you` : `You owe ${other.userName}`}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'monthly' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
              <div className="space-y-0.5">
                <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-indigo-600" />
                  Monthly Detailed Reconciliation
                </h3>
                <p className="text-xs text-slate-500">Person-wise total paid, total owed, and net contributions grouped by month</p>
              </div>

              {monthlyBreakdown.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-xs">No transactions recorded to group by month.</div>
              ) : (
                <div className="space-y-6">
                  {monthlyBreakdown.map((m) => (
                    <div key={m.monthKey} className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-xs">
                      <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex justify-between items-center">
                        <span className="font-bold text-slate-800 text-sm">{m.monthKey}</span>
                        <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-0.5 rounded-lg font-bold">
                          Month Total Spend: ₹{m.totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px] bg-slate-50/50">
                              <th className="py-2.5 px-4 font-bold text-slate-600">Roommate</th>
                              <th className="py-2.5 px-4 text-right font-bold text-slate-600">Total Paid</th>
                              <th className="py-2.5 px-4 text-right font-bold text-slate-600">Total Owed</th>
                              <th className="py-2.5 px-4 text-right font-bold text-slate-600">Net Balance Contribution</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {Object.entries(m.members).map(([name, val]) => {
                              const net = val.paid - val.owed;
                              const isPositive = net >= 0;
                              return (
                                <tr key={name} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="py-2.5 px-4 font-semibold text-slate-800">{name}</td>
                                  <td className="py-2.5 px-4 text-right text-slate-600">₹{val.paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td className="py-2.5 px-4 text-right text-slate-600">₹{val.owed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td className={`py-2.5 px-4 text-right font-bold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                                    {isPositive ? '+' : ''}₹{net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </>
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

      {/* MODAL: Roommate Balance Audit Breakdown */}
      {detailModalItem && detailModalItem.type === 'roommate' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl p-6 space-y-6 shadow-2xl relative max-h-[85vh] overflow-y-auto">
            <button
              onClick={() => { setDetailModalItem(null); setModalLedger([]); }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-lg select-none">
                  {detailModalItem.data.userName[0]}
                </div>
                <div>
                  <h4 className="font-bold text-xl text-slate-900">{detailModalItem.data.userName}'s Balance Audit</h4>
                  <p className="text-xs text-slate-500">Comprehensive breakdown of all transaction contributions</p>
                </div>
              </div>
              <span className={`font-bold text-base px-3.5 py-1.5 rounded-xl ${detailModalItem.data.netBalance >= 0 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                {detailModalItem.data.netBalance >= 0 ? '+' : ''}₹{detailModalItem.data.netBalance.toLocaleString()}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-slate-50 border border-slate-200/60 p-4 rounded-2xl">
              <div className="text-center border-r border-slate-250">
                <span className="block text-[10px] text-slate-450 uppercase font-bold tracking-wider mb-1">Total Paid</span>
                <span className="text-lg font-extrabold text-slate-800">₹{detailModalItem.data.totalPaid.toLocaleString()}</span>
              </div>
              <div className="text-center">
                <span className="block text-[10px] text-slate-450 uppercase font-bold tracking-wider mb-1">Total Owed</span>
                <span className="text-lg font-extrabold text-slate-800">₹{detailModalItem.data.totalOwed.toLocaleString()}</span>
              </div>
            </div>

            {modalLedgerLoading ? (
              <div className="py-16 text-center text-slate-400 text-xs animate-pulse">Loading audit logs...</div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h5 className="font-bold text-slate-900 text-sm mb-3">Expenses Paid (Constitutes ₹{detailModalItem.data.totalPaid.toLocaleString()})</h5>
                  {(() => {
                    const paidExpenses = modalLedger.filter(item => item.wasPaidByMe);
                    if (paidExpenses.length === 0) {
                      return <div className="text-slate-400 text-xs italic py-6 bg-slate-50/50 rounded-xl text-center border border-dashed border-slate-250">No paid expenses recorded.</div>;
                    }
                    return (
                      <div className="overflow-x-auto border border-slate-200 rounded-xl bg-slate-50/30">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px] bg-slate-100">
                              <th className="py-2.5 px-3">Date</th>
                              <th className="py-2.5 px-3">Description</th>
                              <th className="py-2.5 px-3 text-right">Total Paid</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-150">
                            {paidExpenses.map(item => (
                              <tr key={item.expenseId} className="hover:bg-slate-50 transition-colors">
                                <td className="py-2.5 px-3 text-slate-450">{new Date(item.date).toLocaleDateString()}</td>
                                <td className="py-2.5 px-3 font-semibold text-slate-750">
                                  <span>{item.description}</span>
                                  {item.isSettlement ? (
                                    <span className="ml-2 bg-indigo-50 text-indigo-700 border border-indigo-150 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Cash Payback</span>
                                  ) : (
                                    <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                                      Split with: {item.allSplits?.map((s: any) => `${s.userName} (₹${s.owedAmount.toLocaleString()})`).join(', ') || 'Equal split'}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-bold text-slate-850">₹{item.totalAmount.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <h5 className="font-bold text-slate-900 text-sm mb-3">Owed Shares (Constitutes ₹{detailModalItem.data.totalOwed.toLocaleString()})</h5>
                  {(() => {
                    const owedExpenses = modalLedger.filter(item => !item.wasPaidByMe);
                    if (owedExpenses.length === 0) {
                      return <div className="text-slate-400 text-xs italic py-6 bg-slate-50/50 rounded-xl text-center border border-dashed border-slate-250">No owed expenses recorded.</div>;
                    }
                    return (
                      <div className="overflow-x-auto border border-slate-200 rounded-xl bg-slate-50/30">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px] bg-slate-100">
                              <th className="py-2.5 px-3">Date</th>
                              <th className="py-2.5 px-3">Description</th>
                              <th className="py-2.5 px-3">Paid By</th>
                              <th className="py-2.5 px-3 text-right">Total Amount</th>
                              <th className="py-2.5 px-3 text-right">My Share</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-150">
                            {owedExpenses.map(item => (
                              <tr key={item.expenseId} className="hover:bg-slate-50 transition-colors">
                                <td className="py-2.5 px-3 text-slate-450">{new Date(item.date).toLocaleDateString()}</td>
                                <td className="py-2.5 px-3 font-semibold text-slate-750">
                                  <span>{item.description}</span>
                                  {item.isSettlement ? (
                                    <span className="ml-2 bg-indigo-50 text-indigo-700 border border-indigo-150 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Cash Payback</span>
                                  ) : (
                                    <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                                      Split with: {item.allSplits?.map((s: any) => `${s.userName} (₹${s.owedAmount.toLocaleString()})`).join(', ') || 'Equal split'}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600 font-medium">{item.paidByUserName}</td>
                                <td className="py-2.5 px-3 text-right text-slate-500">₹{item.totalAmount.toLocaleString()}</td>
                                <td className="py-2.5 px-3 text-right font-bold text-red-500">₹{item.myOwedShare.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Settlement Verification Breakdown */}
      {detailModalItem && detailModalItem.type === 'settlement' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl p-6 space-y-6 shadow-2xl relative max-h-[85vh] overflow-y-auto">
            <button
              onClick={() => { setDetailModalItem(null); setModalLedger([]); }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-750 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1 pb-3 border-b border-slate-100">
              <h4 className="font-bold text-lg text-slate-900">Settlement Verification</h4>
              <p className="text-xs text-slate-500">Optimized transfer calculation details</p>
            </div>

            {modalLedgerLoading ? (
              <div className="py-16 text-center text-slate-400 text-xs animate-pulse">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                Loading auditing details...
              </div>
            ) : (() => {
              const debts = modalLedger.filter(item => !item.wasPaidByMe && item.paidByUserName === detailModalItem.data.toUserName);
              const totalDebts = debts.reduce((sum, item) => sum + (item.myOwedShare || item.totalAmount), 0);

              const credits = modalLedger
                .filter(item => item.wasPaidByMe)
                .map(item => {
                  const targetSplit = item.allSplits?.find((s: any) => s.userName === detailModalItem.data.toUserName);
                  if (!targetSplit) return null;
                  return {
                    ...item,
                    targetOwedShare: targetSplit.owedAmount
                  };
                })
                .filter(Boolean) as any[];
              const totalCredits = credits.reduce((sum, item) => sum + item.targetOwedShare, 0);

              const directNet = totalDebts - totalCredits;
              const isFlipped = directNet < 0;
              const displayAmount = Math.abs(directNet);
              const fromName = isFlipped ? detailModalItem.data.toUserName : detailModalItem.data.fromUserName;
              const toName = isFlipped ? detailModalItem.data.fromUserName : detailModalItem.data.toUserName;

              return (
                <div className="space-y-6">
                  {/* Dynamic Transfer Header */}
                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-center space-y-2">
                    <div className="text-sm font-semibold text-slate-800">
                      <span className="text-red-500 font-bold">{fromName}</span>
                      <span className="text-slate-400 mx-2">should transfer</span>
                      <span className="text-indigo-600 font-extrabold text-base block my-1">
                        ₹{displayAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-slate-400 mx-2">to</span>
                      <span className="text-emerald-600 font-bold">{toName}</span>
                    </div>
                  </div>

                  {/* Direct peer-to-peer balance reconciliation */}
                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-xs space-y-3">
                    <div className="font-bold text-slate-800 text-center pb-2 border-b border-slate-200">
                      Direct peer-to-peer balance reconciliation
                    </div>
                    <div className="space-y-2">
                      <div
                        onClick={() => setExpandModalDebts(!expandModalDebts)}
                        className="flex justify-between items-center p-2 rounded-lg hover:bg-slate-150 cursor-pointer transition-colors border border-transparent hover:border-slate-200"
                        title="Click to toggle itemized debts list"
                      >
                        <span className="font-semibold text-slate-655 flex items-center gap-1">
                          Direct Debts ({detailModalItem.data.fromUserName} owes {detailModalItem.data.toUserName})
                          <span className="text-[10px] text-indigo-500 font-normal">({expandModalDebts ? 'Click to hide ▴' : 'Click to view ▾'})</span>
                        </span>
                        <span className="text-right font-extrabold text-slate-850">₹{totalDebts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      
                      <div
                        onClick={() => setExpandModalCredits(!expandModalCredits)}
                        className="flex justify-between items-center p-2 rounded-lg hover:bg-slate-150 cursor-pointer transition-colors border border-transparent hover:border-slate-200"
                        title="Click to toggle itemized credits list"
                      >
                        <span className="font-semibold text-slate-655 flex items-center gap-1">
                          Direct Offset Credits ({detailModalItem.data.toUserName} owes {detailModalItem.data.fromUserName})
                          <span className="text-[10px] text-indigo-500 font-normal">({expandModalCredits ? 'Click to hide ▴' : 'Click to view ▾'})</span>
                        </span>
                        <span className="text-right font-extrabold text-slate-850">-₹{totalCredits.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-200 flex justify-between font-extrabold text-indigo-750 text-sm">
                      <span>Net Cash Payback:</span>
                      <span className={isFlipped ? 'text-red-500' : 'text-indigo-750'}>
                        {isFlipped ? '-' : ''}₹{displayAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {expandModalDebts && (
                    <div className="animate-fadeIn border border-slate-200 p-4 bg-slate-50/20 rounded-2xl space-y-3">
                      <h5 className="font-bold text-slate-905 text-xs flex justify-between border-b border-slate-200 pb-2">
                        <span>Direct Debts Breakdown</span>
                        <span className="text-slate-400">({detailModalItem.data.fromUserName} owes {detailModalItem.data.toUserName})</span>
                      </h5>
                      {debts.length === 0 ? (
                        <div className="text-slate-400 text-xs italic py-4 bg-slate-50/50 rounded-xl text-center border border-dashed border-slate-255">No direct debts recorded where {detailModalItem.data.fromUserName} owes {detailModalItem.data.toUserName}.</div>
                      ) : (
                        <div className="space-y-2">
                          <div className="overflow-x-auto border border-slate-200 rounded-xl bg-slate-50/30">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px] bg-slate-100">
                                  <th className="py-2.5 px-3">Date</th>
                                  <th className="py-2.5 px-3">Description</th>
                                  <th className="py-2.5 px-3 text-right">Total Amount</th>
                                  <th className="py-2.5 px-3 text-right">Owed Share</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-150">
                                {debts.map(item => (
                                  <tr key={item.expenseId} className="hover:bg-slate-50 transition-colors">
                                    <td className="py-2.5 px-3 text-slate-450">{new Date(item.date).toLocaleDateString()}</td>
                                    <td className="py-2.5 px-3 font-semibold text-slate-755">
                                      <span>{item.description}</span>
                                      {item.isSettlement ? (
                                        <span className="ml-2 bg-indigo-50 text-indigo-700 border border-indigo-150 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Cash Payback</span>
                                      ) : (
                                        <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                                          Split with: {item.allSplits?.map((s: any) => `${s.userName} (₹${s.owedAmount.toLocaleString()})`).join(', ') || 'Equal split'}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 text-right text-slate-500">₹{item.totalAmount.toLocaleString()}</td>
                                    <td className="py-2.5 px-3 text-right font-bold text-red-500">₹{(item.myOwedShare || item.totalAmount).toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="text-right text-xs font-bold text-slate-750 pr-3">
                            Total Owed: ₹{totalDebts.toLocaleString()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {expandModalCredits && (
                    <div className="animate-fadeIn border border-slate-200 p-4 bg-slate-50/20 rounded-2xl space-y-3">
                      <h5 className="font-bold text-slate-905 text-xs flex justify-between border-b border-slate-200 pb-2">
                        <span>Offset Credits Breakdown</span>
                        <span className="text-slate-400">({detailModalItem.data.toUserName} owes {detailModalItem.data.fromUserName})</span>
                      </h5>
                      {credits.length === 0 ? (
                        <div className="text-slate-400 text-xs italic py-4 bg-slate-50/50 rounded-xl text-center border border-dashed border-slate-255">No offset credits recorded where {detailModalItem.data.toUserName} owes {detailModalItem.data.fromUserName}.</div>
                      ) : (
                        <div className="space-y-2">
                          <div className="overflow-x-auto border border-slate-200 rounded-xl bg-slate-50/30">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px] bg-slate-100">
                                  <th className="py-2.5 px-3">Date</th>
                                  <th className="py-2.5 px-3">Description</th>
                                  <th className="py-2.5 px-3 text-right">Total Amount</th>
                                  <th className="py-2.5 px-3 text-right">Offset Share</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-150">
                                {credits.map(item => (
                                  <tr key={item.expenseId} className="hover:bg-slate-50 transition-colors">
                                    <td className="py-2.5 px-3 text-slate-450">{new Date(item.date).toLocaleDateString()}</td>
                                    <td className="py-2.5 px-3 font-semibold text-slate-755">
                                      <span>{item.description}</span>
                                      {item.isSettlement ? (
                                        <span className="ml-2 bg-indigo-50 text-indigo-700 border border-indigo-150 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Cash Payback</span>
                                      ) : (
                                        <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                                          Split with: {item.allSplits?.map((s: any) => `${s.userName} (₹${s.owedAmount.toLocaleString()})`).join(', ') || 'Equal split'}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 text-right text-slate-500">₹{item.totalAmount.toLocaleString()}</td>
                                    <td className="py-2.5 px-3 text-right font-bold text-emerald-600">₹{item.targetOwedShare.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="text-right text-xs font-bold text-slate-755 pr-3">
                            Total Credits: ₹{totalCredits.toLocaleString()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  setSettlePayerId(detailModalItem.data.fromUserId);
                  setSettlePayeeId(detailModalItem.data.toUserId);
                  setSettleAmount(detailModalItem.data.amount.toString());
                  setIsSettleModalOpen(true);
                  setDetailModalItem(null);
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2.5 rounded-xl transition-colors cursor-pointer text-center"
              >
                Record Cash Payback Now
              </button>
            </div>
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
