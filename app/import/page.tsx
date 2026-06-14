'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, Upload, FileText, CheckCircle, AlertTriangle, 
  Trash2, Edit, Check, X, Info, Home
} from 'lucide-react';

interface StagedExpense {
  id: string;
  sessionId: string;
  rawRowNumber: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'RESOLVED' | 'REJECTED';
  rawData: {
    date: string;
    description: string;
    paid_by: string;
    amount: string;
    currency: string;
    split_type: string;
    split_with: string;
    split_details: string;
    notes: string;
  };
  detectedAnomalies: string[];
}

interface UserItem {
  id: string;
  name: string;
}

export default function ImportConsole() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stagedExpenses, setStagedExpenses] = useState<StagedExpense[]>([]);
  const [report, setReport] = useState<{
    total: number;
    pending: number;
    anomalies: number;
  } | null>(null);

  const [parsing, setParsing] = useState(false);
  const [loadingStaged, setLoadingStaged] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPayer, setEditPayer] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCurrency, setEditCurrency] = useState('');
  const [editSplitType, setEditSplitType] = useState('');
  const [editSplitWith, setEditSplitWith] = useState('');
  const [editSplitDetails, setEditSplitDetails] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inputCls = 'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-colors';

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => { if (data.success) setUsers(data.users); })
      .catch(console.error);

    const savedSession = localStorage.getItem('importSessionId');
    if (savedSession) {
      setSessionId(savedSession);
      fetchStaged(savedSession);
    }
  }, []);

  const fetchStaged = async (sessId: string) => {
    setLoadingStaged(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/import/staged?sessionId=${sessId}`);
      const data = await res.json();
      if (data.success) {
        setStagedExpenses(data.stagedExpenses);
        const total = data.stagedExpenses.length;
        const pending = data.stagedExpenses.filter((e: StagedExpense) => e.status === 'PENDING_APPROVAL').length;
        const anomalies = data.stagedExpenses.filter((e: StagedExpense) => e.detectedAnomalies.length > 0 && e.status === 'PENDING_APPROVAL').length;
        setReport({ total, pending, anomalies });
      } else {
        setErrorMessage(data.error || 'Failed to fetch staged expenses.');
      }
    } catch {
      setErrorMessage('Network error fetching staged expenses.');
    } finally {
      setLoadingStaged(false);
    }
  };

  const handleUploadParse = async () => {
    setParsing(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/import/upload', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSessionId(data.sessionId);
        localStorage.setItem('importSessionId', data.sessionId);
        await fetchStaged(data.sessionId);
      } else {
        setErrorMessage(data.error || 'Failed to parse CSV file.');
      }
    } catch {
      setErrorMessage('Network error initiating upload.');
    } finally {
      setParsing(false);
    }
  };

  const handleResolve = async (id: string, action: 'APPROVE' | 'REJECT' | 'RESOLVE_EDIT', overrides?: Record<string, unknown>) => {
    setResolvingId(id);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/import/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stagedExpenseId: id, action, overrides }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingId(null);
        if (sessionId) await fetchStaged(sessionId);
      } else {
        setErrorMessage(data.error || 'Failed to resolve staged expense.');
      }
    } catch {
      setErrorMessage('Error transmitting resolution request.');
    } finally {
      setResolvingId(null);
    }
  };

  const startInlineEdit = (item: StagedExpense) => {
    setEditingId(item.id);
    setEditPayer(item.rawData.paid_by);
    setEditAmount(item.rawData.amount.replace(/,/g, ''));
    setEditCurrency(item.rawData.currency || 'INR');
    setEditSplitType(item.rawData.split_type || 'equal');
    setEditSplitWith(item.rawData.split_with);
    setEditSplitDetails(item.rawData.split_details || '');
    setEditDescription(item.rawData.description);
    setEditNotes(item.rawData.notes || '');
  };

  const submitInlineEdit = (id: string) => {
    const splitWithArr = editSplitWith.split(';').map(s => s.trim()).filter(Boolean);
    handleResolve(id, 'RESOLVE_EDIT', {
      paidBy: editPayer,
      amount: parseFloat(editAmount),
      currency: editCurrency,
      splitType: editSplitType,
      splitWith: splitWithArr,
      splitDetails: editSplitDetails,
      description: editDescription,
      notes: editNotes,
    });
  };

  const allResolved = report && report.total > 0 && report.pending === 0;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-800 font-sans">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Home className="w-4 h-4 text-indigo-600" />
              <span className="font-semibold text-lg bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                CSV Ingestion & Anomaly Resolver
              </span>
            </div>
          </div>
          <Link href="/" className="text-xs sm:text-sm text-slate-500 hover:text-slate-800 transition-colors font-medium">
            Roommate Dashboard
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto px-6 py-10 w-full space-y-8">

        {/* Error Alert */}
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" />
            <div>
              <h4 className="font-semibold text-sm">Operation Failed</h4>
              <p className="text-xs text-red-500 mt-1">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Upload Console */}
        <div className="bg-white border border-slate-200 rounded-3xl p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-6 h-6 text-indigo-600" />
              Ingestion Console
            </h2>
            <p className="text-slate-500 text-sm max-w-lg">
              Parses the server file <code className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded text-xs font-mono">data/expenses_export.csv</code>, stages all rows in SQLite, and flags overlaps, unregistered users, or math discrepancies for human review.
            </p>
          </div>

          <button
            onClick={handleUploadParse}
            disabled={parsing}
            className="inline-flex items-center justify-center gap-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium text-base px-6 py-3.5 rounded-2xl transition-all shadow-md shadow-indigo-600/10 cursor-pointer self-start md:self-auto"
          >
            {parsing ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Upload className="w-5 h-5" />
            )}
            Parse expenses_export.csv
          </button>
        </div>

        {/* All Resolved Banner */}
        {allResolved && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-6 rounded-3xl flex items-start gap-4 shadow-sm">
            <CheckCircle className="w-6 h-6 flex-shrink-0 mt-0.5 text-emerald-500" />
            <div className="space-y-1">
              <h4 className="font-bold text-lg text-emerald-800">Ingestion Session Finalized!</h4>
              <p className="text-sm text-emerald-600">
                All staged CSV records have been resolved and written to the production database ledger.
              </p>
              <div className="pt-2">
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 text-xs text-emerald-600 font-semibold hover:underline"
                >
                  Return to Roommate Selector and view dashboards →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Report + Staging Grid */}
        {sessionId && (
          <div className="space-y-6">
            {report && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 flex items-center justify-between shadow-sm">
                  <div>
                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Total Rows</span>
                    <h3 className="text-3xl font-bold text-slate-900 mt-1">{report.total}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">T</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-6 flex items-center justify-between shadow-sm">
                  <div>
                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Unresolved Pending</span>
                    <h3 className="text-3xl font-bold text-slate-900 mt-1">{report.pending}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500 font-bold text-sm">P</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-6 flex items-center justify-between shadow-sm">
                  <div>
                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Flagged Anomaly Rows</span>
                    <h3 className="text-3xl font-bold text-red-500 mt-1">{report.anomalies}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-red-500 font-bold text-sm">A</div>
                </div>
              </div>
            )}

            {/* Staging Area Grid */}
            <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">Staging Area Grid</h3>
                <span className="text-xs text-slate-400">
                  Session: <code className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-mono">{sessionId.slice(0, 8)}...</code>
                </span>
              </div>

              {loadingStaged ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400 text-sm">
                  <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  Loading staged records...
                </div>
              ) : stagedExpenses.length === 0 ? (
                <div className="py-20 text-center text-slate-400 text-sm">
                  Staging area is empty. Parse the CSV file above.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {stagedExpenses.map((item) => {
                    const hasAnomalies = item.detectedAnomalies.length > 0;
                    const isPending = item.status === 'PENDING_APPROVAL';
                    const isEditing = editingId === item.id;
                    const isResolving = resolvingId === item.id;

                    return (
                      <div key={item.id} className={`p-6 space-y-4 transition-colors ${!isPending ? 'bg-slate-50/60' : 'bg-white'}`}>
                        {/* Row header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-slate-400 font-mono">#{item.rawRowNumber}</span>
                            <h4 className="font-semibold text-slate-800 text-base">{item.rawData.description}</h4>
                            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">{item.rawData.date}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            {item.status === 'APPROVED' && (
                              <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-200 px-2.5 py-1 rounded-full font-semibold">Approved</span>
                            )}
                            {item.status === 'RESOLVED' && (
                              <span className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 px-2.5 py-1 rounded-full font-semibold">Resolved & Committed</span>
                            )}
                            {item.status === 'REJECTED' && (
                              <span className="text-xs bg-red-50 text-red-500 border border-red-200 px-2.5 py-1 rounded-full font-semibold">Rejected</span>
                            )}
                            {isPending && !hasAnomalies && (
                              <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-200 px-2.5 py-1 rounded-full font-semibold flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Ready to Commit
                              </span>
                            )}
                            {isPending && hasAnomalies && (
                              <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2.5 py-1 rounded-full font-semibold flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5" /> Flagged Anomalies
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Raw Data */}
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          <div>
                            <span className="text-slate-400 block mb-1 font-medium">Paid By:</span>
                            <span className="text-slate-700 font-semibold">{item.rawData.paid_by || <em className="text-red-400 font-normal">Missing</em>}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block mb-1 font-medium">Amount:</span>
                            <span className="text-slate-700 font-semibold">{item.rawData.amount} {item.rawData.currency || <em className="text-red-400 font-normal">Missing</em>}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block mb-1 font-medium">Split Type:</span>
                            <span className="text-slate-700 font-semibold capitalize">{item.rawData.split_type || 'Settlement'}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block mb-1 font-medium">Split With:</span>
                            <span className="text-slate-700 font-semibold truncate block">{item.rawData.split_with}</span>
                          </div>
                          {item.rawData.split_details && (
                            <div className="col-span-2 md:col-span-4 border-t border-slate-200 pt-2 mt-1">
                              <span className="text-slate-400 block mb-1 font-medium">Split Details:</span>
                              <span className="text-indigo-600 font-mono">{item.rawData.split_details}</span>
                            </div>
                          )}
                          {item.rawData.notes && (
                            <div className="col-span-2 md:col-span-4 border-t border-slate-200 pt-2">
                              <span className="text-slate-400 block mb-1 font-medium">Notes:</span>
                              <span className="text-slate-500 italic">{item.rawData.notes}</span>
                            </div>
                          )}
                        </div>

                        {/* Anomaly Badges */}
                        {isPending && hasAnomalies && (
                          <div className="flex flex-wrap gap-2">
                            {item.detectedAnomalies.map((code, idx) => (
                              <span key={`${code}-${idx}`} className="text-[10px] uppercase font-bold tracking-wider bg-red-50 border border-red-200 text-red-500 px-2.5 py-0.5 rounded-md flex items-center gap-1.5">
                                <Info className="w-3 h-3" />
                                {code.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Inline Edit Override Form */}
                        {isEditing && (
                          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-6 space-y-4">
                            <h5 className="font-semibold text-sm text-indigo-700 flex items-center gap-2 pb-2 border-b border-indigo-200">
                              <Edit className="w-4 h-4" />
                              Interactive Override Form
                            </h5>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                              <div className="space-y-1">
                                <label className="text-slate-600 block font-semibold">Payer (paid_by):</label>
                                <select value={editPayer} onChange={(e) => setEditPayer(e.target.value)} className={inputCls}>
                                  <option value="">Select Roommate</option>
                                  {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="text-slate-600 block font-semibold">Amount:</label>
                                <input type="text" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className={inputCls} />
                              </div>

                              <div className="space-y-1">
                                <label className="text-slate-600 block font-semibold">Currency:</label>
                                <select value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)} className={inputCls}>
                                  <option value="INR">INR</option>
                                  <option value="USD">USD</option>
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="text-slate-600 block font-semibold">Split Type:</label>
                                <select value={editSplitType} onChange={(e) => setEditSplitType(e.target.value)} className={inputCls}>
                                  <option value="equal">Equal</option>
                                  <option value="unequal">Unequal</option>
                                  <option value="percentage">Percentage</option>
                                  <option value="share">Share</option>
                                </select>
                              </div>

                              <div className="space-y-1 md:col-span-2">
                                <label className="text-slate-600 block font-semibold">Split With (semicolon separated):</label>
                                <input type="text" value={editSplitWith} onChange={(e) => setEditSplitWith(e.target.value)} className={`${inputCls} font-mono`} />
                              </div>

                              <div className="space-y-1 md:col-span-3">
                                <label className="text-slate-600 block font-semibold">Split Details:</label>
                                <input type="text" value={editSplitDetails} onChange={(e) => setEditSplitDetails(e.target.value)} placeholder="Rohan 700; Priya 400 or Aisha 30%; Rohan 30%" className={`${inputCls} font-mono`} />
                              </div>

                              <div className="space-y-1 md:col-span-3">
                                <label className="text-slate-600 block font-semibold">Description:</label>
                                <input type="text" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className={inputCls} />
                              </div>
                            </div>

                            <div className="flex gap-2 justify-end pt-3">
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-4 py-2 bg-white hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-600 border border-slate-200 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => submitInlineEdit(item.id)}
                                disabled={isResolving}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 rounded-xl text-xs font-semibold text-white transition-all shadow-md shadow-indigo-600/10"
                              >
                                {isResolving ? 'Resolving...' : 'Commit Overrides'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Action Buttons */}
                        {isPending && !isEditing && (
                          <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-slate-100">
                            <button
                              onClick={() => handleResolve(item.id, 'REJECT')}
                              disabled={isResolving}
                              className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 hover:bg-red-100 text-red-500 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Reject Row
                            </button>

                            <button
                              onClick={() => startInlineEdit(item)}
                              className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 transition-all"
                            >
                              <Edit className="w-3.5 h-3.5" /> Interactive Resolve
                            </button>

                            <button
                              onClick={() => handleResolve(item.id, 'APPROVE')}
                              disabled={isResolving || hasAnomalies}
                              className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:border text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-md shadow-emerald-600/10 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" /> Quick Approve
                            </button>
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
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-slate-400 text-xs mt-12">
        <p>© 2026 SplitSmart Roommate Settlement Engine. Built for Spreetail.</p>
      </footer>
    </div>
  );
}
