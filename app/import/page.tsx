'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle,
  Edit,
  FileText,
  Filter,
  Home,
  Info,
  RefreshCw,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';

interface RawData {
  date: string;
  description: string;
  paid_by: string;
  amount: string;
  currency: string;
  split_type: string;
  split_with: string;
  split_details: string;
  notes: string;
}

interface ResolvedData {
  date: string;
  description: string;
  paidBy: string;
  amount: number;
  currency: string;
  exchangeRate?: number;
  splitType: 'equal' | 'unequal' | 'percentage' | 'share';
  splitWith: string[];
  splitDetails: string;
  notes: string;
  isSettlement: boolean;
}

interface StagedExpense {
  id: string;
  rawRowNumber: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'RESOLVED' | 'REJECTED';
  rawData: RawData;
  resolvedData: ResolvedData | null;
  resolutionSummary: string | null;
  resolutionMode: string | null;
  committedExpenseId: string | null;
  detectedAnomalies: string[];
}

interface UserItem {
  id: string;
  name: string;
}

interface AnomalyDefinition {
  code: string;
  label: string;
  shortLabel: string;
  description: string;
  policy: string;
  canApplyPolicy: boolean;
  manualHint: string;
}

interface BreakdownItem {
  code: string;
  definition: AnomalyDefinition;
  total: number;
  pending: number;
  resolved: number;
  rejected: number;
}

interface ImportReport {
  totalRows: number;
  pending: number;
  resolved: number;
  rejected: number;
  anomalyRows: number;
  cleanRows: number;
  breakdown: BreakdownItem[];
}

interface EditState {
  date: string;
  description: string;
  paidBy: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  splitType: 'equal' | 'unequal' | 'percentage' | 'share';
  splitWith: string[];
  splitValues: Record<string, string>;
  notes: string;
  isSettlement: boolean;
}

const statusLabels: Record<StagedExpense['status'], string> = {
  PENDING_APPROVAL: 'Pending',
  APPROVED: 'Approved',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

export default function ImportConsole() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stagedExpenses, setStagedExpenses] = useState<StagedExpense[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [definitions, setDefinitions] = useState<Record<string, AnomalyDefinition>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeAnomaly, setActiveAnomaly] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    return stagedExpenses.filter((item) => {
      const anomalyMatch = activeAnomaly === 'ALL' || item.detectedAnomalies.includes(activeAnomaly);
      const statusMatch = statusFilter === 'ALL' || item.status === statusFilter;
      return anomalyMatch && statusMatch;
    });
  }, [activeAnomaly, stagedExpenses, statusFilter]);

  useEffect(() => {
    const savedSessionId = localStorage.getItem('importSessionId');
    if (savedSessionId) setSessionId(savedSessionId);
  }, []);

  const autoSupported = (item: StagedExpense) => {
    if (item.detectedAnomalies.length === 0) return true;
    return item.detectedAnomalies.every((code) => definitions[code]?.canApplyPolicy);
  };

  const fetchStaged = useCallback(async (sessId: string) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/import/staged?sessionId=${sessId}`);
      const data = await res.json();
      if (!data.success) {
        setErrorMessage(data.error || 'Failed to fetch staged expenses.');
        return;
      }
      setStagedExpenses(data.stagedExpenses);
      setReport(data.report);
      setDefinitions(data.anomalyDefinitions || {});
    } catch {
      setErrorMessage('Network error while loading staged expenses.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => { if (data.success) setUsers(data.users); })
      .catch(console.error);

    if (sessionId) {
      void Promise.resolve().then(() => fetchStaged(sessionId));
    }
  }, [fetchStaged, sessionId]);

  const handleUploadParse = async () => {
    setBusyKey('upload');
    setErrorMessage(null);
    try {
      const options: RequestInit = { method: 'POST' };
      if (selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);
        options.body = formData;
      }
      const res = await fetch('/api/import/upload', options);
      const data = await res.json();
      if (!data.success) {
        setErrorMessage(data.details || data.error || 'Failed to parse CSV.');
        return;
      }
      setSessionId(data.sessionId);
      localStorage.setItem('importSessionId', data.sessionId);
      setActiveAnomaly('ALL');
      setStatusFilter('ALL');
      await fetchStaged(data.sessionId);
    } catch {
      setErrorMessage('Network error while importing CSV.');
    } finally {
      setBusyKey(null);
    }
  };

  const resolveRow = async (
    id: string,
    action: 'APPROVE' | 'REJECT' | 'RESOLVE_EDIT' | 'APPLY_POLICY',
    overrides?: Record<string, unknown>
  ) => {
    setBusyKey(`${action}-${id}`);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/import/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stagedExpenseId: id, action, overrides }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMessage(data.error || 'Resolution failed.');
        return;
      }
      setEditingId(null);
      setEditState(null);
      if (sessionId) await fetchStaged(sessionId);
    } catch {
      setErrorMessage('Network error while resolving row.');
    } finally {
      setBusyKey(null);
    }
  };

  const applyCategoryPolicy = async (anomalyCode: string) => {
    if (!sessionId) return;
    setBusyKey(`category-${anomalyCode}`);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/import/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPLY_CATEGORY_POLICY', sessionId, anomalyCode }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMessage(data.error || 'Category policy failed.');
        return;
      }
      if (data.skipped?.length) {
        setErrorMessage(`${data.skipped.length} row(s) still need manual review. First: row ${data.skipped[0].rowNumber} - ${data.skipped[0].reason}`);
      }
      await fetchStaged(sessionId);
    } catch {
      setErrorMessage('Network error while applying category policy.');
    } finally {
      setBusyKey(null);
    }
  };

  const startEdit = (item: StagedExpense) => {
    const source = item.resolvedData || rowToResolvedData(item.rawData);
    setEditingId(item.id);
    setEditState({
      date: normalizeDateForInput(source.date),
      description: source.description,
      paidBy: source.paidBy,
      amount: String(source.amount),
      currency: source.currency || 'INR',
      exchangeRate: source.exchangeRate ? String(source.exchangeRate) : '',
      splitType: source.splitType || 'equal',
      splitWith: source.splitWith || [],
      splitValues: parseSplitValues(source.splitDetails),
      notes: source.notes || '',
      isSettlement: Boolean(source.isSettlement),
    });
  };

  const toggleParticipant = (name: string) => {
    setEditState((current) => {
      if (!current) return current;
      const exists = current.splitWith.includes(name);
      const splitWith = exists
        ? current.splitWith.filter((item) => item !== name)
        : [...current.splitWith, name];
      return { ...current, splitWith };
    });
  };

  const updateSplitValue = (name: string, value: string) => {
    setEditState((current) => current ? {
      ...current,
      splitValues: { ...current.splitValues, [name]: value },
    } : current);
  };

  const submitEdit = (id: string) => {
    if (!editState) return;
    resolveRow(id, 'RESOLVE_EDIT', {
      paidBy: editState.paidBy,
      amount: Number(editState.amount),
      currency: editState.currency,
      exchangeRate: editState.exchangeRate ? Number(editState.exchangeRate) : undefined,
      splitType: editState.splitType,
      splitWith: editState.splitWith,
      splitDetails: buildSplitDetails(editState),
      description: editState.description,
      date: editState.date,
      notes: editState.notes,
      isSettlement: editState.isSettlement,
    });
  };

  const allDone = report && report.totalRows > 0 && report.pending === 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-800">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2 font-semibold">
              <Home className="h-4 w-4 text-indigo-600" />
              CSV Anomaly Resolver
            </div>
          </div>
          <Link href="/" className="text-sm font-medium text-slate-500 hover:text-slate-900">
            Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {errorMessage && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold text-slate-950">
                <FileText className="h-5 w-5 text-indigo-600" />
                Import Review Console
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Every CSV row is staged first. Ledger writes happen only after approval, policy action, or manual edit.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                <Upload className="h-4 w-4 text-indigo-600" />
                <span className="truncate">{selectedFile ? selectedFile.name : 'Choose CSV'}</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
              </label>

              <button
                onClick={handleUploadParse}
                disabled={busyKey === 'upload'}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-slate-300"
              >
                {busyKey === 'upload' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {selectedFile ? 'Parse Selected CSV' : 'Parse Sample CSV'}
              </button>
            </div>
          </div>
        </section>

        {report && (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Metric label="Rows" value={report.totalRows} />
            <Metric label="Anomaly Rows" value={report.anomalyRows} tone="red" />
            <Metric label="Pending" value={report.pending} tone="amber" />
            <Metric label="Resolved" value={report.resolved} tone="emerald" />
            <Metric label="Rejected" value={report.rejected} tone="slate" />
          </section>
        )}

        {allDone && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
            All staged rows have been resolved or rejected.
          </div>
        )}

        {report && (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="flex items-center gap-2 font-bold text-slate-950">
                  <Filter className="h-4 w-4 text-indigo-600" />
                  Anomaly Breakdown
                </h2>
                <p className="mt-1 text-xs text-slate-500">Select a category to review only those rows, or apply its documented policy in bulk.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setActiveAnomaly('ALL')}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold ${activeAnomaly === 'ALL' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  All Anomalies
                </button>
                <button
                  onClick={() => applyCategoryPolicy('ALL')}
                  disabled={busyKey === 'category-ALL'}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300"
                  title="Apply every supported policy. Rows with manual-only anomalies are skipped."
                >
                  <Info className="h-3.5 w-3.5" />
                  Apply Supported Policies
                </button>
              </div>
            </div>

            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {report.breakdown.map((item) => (
                <div key={item.code} className={`rounded-lg border p-4 ${activeAnomaly === item.code ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <button
                        onClick={() => setActiveAnomaly(item.code)}
                        className="text-left text-sm font-bold text-slate-900 hover:text-indigo-700"
                      >
                        {item.definition.label}
                      </button>
                      <p className="mt-1 text-xs text-slate-500">{item.definition.description}</p>
                    </div>
                    <span className="rounded-md bg-red-100 px-2 py-1 text-xs font-bold text-red-600">{item.total}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                    <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">Pending {item.pending}</span>
                    <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700">Resolved {item.resolved}</span>
                    <span className="rounded bg-slate-200 px-2 py-1 text-slate-600">Rejected {item.rejected}</span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => setActiveAnomaly(item.code)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Manual Review
                    </button>
                    <button
                      onClick={() => applyCategoryPolicy(item.code)}
                      disabled={!item.definition.canApplyPolicy || busyKey === `category-${item.code}`}
                      title={item.definition.canApplyPolicy ? item.definition.policy : item.definition.manualHint}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:bg-slate-300"
                    >
                      <Info className="h-3.5 w-3.5" />
                      Apply Policy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {sessionId && (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-bold text-slate-950">Staged Rows</h2>
                <p className="mt-1 text-xs text-slate-500">Showing {filteredRows.length} row(s). Session {sessionId.slice(0, 8)}.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  <option value="ALL">All statuses</option>
                  <option value="PENDING_APPROVAL">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="REJECTED">Rejected</option>
                </select>
                <button
                  onClick={() => sessionId && fetchStaged(sessionId)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading staged rows...
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-400">No rows match the current filters.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredRows.map((item) => {
                  const isPending = item.status === 'PENDING_APPROVAL';
                  const isEditing = editingId === item.id && editState;
                  return (
                    <article key={item.id} className={`space-y-4 p-5 ${isPending ? 'bg-white' : 'bg-slate-50'}`}>
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-bold text-slate-400">#{item.rawRowNumber}</span>
                            <h3 className="font-semibold text-slate-900">{item.rawData.description}</h3>
                            <StatusBadge status={item.status} />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.detectedAnomalies.length === 0 ? (
                              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Clean Row</span>
                            ) : item.detectedAnomalies.map((code) => (
                              <span key={code} className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-600">
                                {definitions[code]?.shortLabel || code.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => startEdit(item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <Edit className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          {isPending && (
                            <>
                              <button
                                onClick={() => resolveRow(item.id, 'APPLY_POLICY')}
                                disabled={!autoSupported(item) || busyKey === `APPLY_POLICY-${item.id}`}
                                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:bg-slate-300"
                                title={item.detectedAnomalies.map((code) => definitions[code]?.policy).filter(Boolean).join(' ')}
                              >
                                <Info className="h-3.5 w-3.5" />
                                Apply Policy
                              </button>
                              <button
                                onClick={() => resolveRow(item.id, 'APPROVE')}
                                disabled={item.detectedAnomalies.length > 0 || busyKey === `APPROVE-${item.id}`}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:bg-slate-300"
                              >
                                <Check className="h-3.5 w-3.5" />
                                Approve
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => resolveRow(item.id, 'REJECT')}
                            disabled={busyKey === `REJECT-${item.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 text-xs md:grid-cols-2">
                        <DataPanel title="Earlier CSV Row" data={[
                          ['Date', item.rawData.date],
                          ['Paid by', item.rawData.paid_by || 'Missing'],
                          ['Amount', `${item.rawData.amount} ${item.rawData.currency || 'Missing'}`],
                          ['Split', `${item.rawData.split_type || 'Settlement'} · ${item.rawData.split_with || 'None'}`],
                          ['Details', item.rawData.split_details || 'None'],
                          ['Notes', item.rawData.notes || 'None'],
                        ]} />
                        <DataPanel title="Resolved Ledger Version" muted={!item.resolvedData} data={[
                          ['Date', item.resolvedData?.date || 'Not committed'],
                          ['Paid by', item.resolvedData?.paidBy || 'Not committed'],
                          ['Amount', item.resolvedData ? `${item.resolvedData.amount} ${item.resolvedData.currency}${item.resolvedData.exchangeRate ? ` · rate ${item.resolvedData.exchangeRate}` : ''}` : 'Not committed'],
                          ['Split', item.resolvedData ? `${item.resolvedData.isSettlement ? 'Settlement' : item.resolvedData.splitType} · ${item.resolvedData.splitWith.join(', ')}` : 'Not committed'],
                          ['Details', item.resolvedData?.splitDetails || 'None'],
                          ['Action', item.resolutionSummary || 'Awaiting review'],
                        ]} />
                      </div>

                      {isEditing && (
                        <ManualEditor
                          users={users}
                          state={editState}
                          setState={setEditState}
                          toggleParticipant={toggleParticipant}
                          updateSplitValue={updateSplitValue}
                          onCancel={() => { setEditingId(null); setEditState(null); }}
                          onSubmit={() => submitEdit(item.id)}
                          busy={busyKey === `RESOLVE_EDIT-${item.id}`}
                        />
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'red' | 'amber' | 'emerald' }) {
  const tones = {
    slate: 'text-slate-900 bg-slate-100',
    red: 'text-red-600 bg-red-50',
    amber: 'text-amber-600 bg-amber-50',
    emerald: 'text-emerald-600 bg-emerald-50',
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 inline-flex rounded-lg px-3 py-1 text-2xl font-bold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: StagedExpense['status'] }) {
  const classes = {
    PENDING_APPROVAL: 'border-amber-200 bg-amber-50 text-amber-700',
    APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    RESOLVED: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    REJECTED: 'border-slate-200 bg-slate-100 text-slate-600',
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${classes[status]}`}>
      {statusLabels[status]}
    </span>
  );
}

function DataPanel({ title, data, muted = false }: { title: string; data: Array<[string, string]>; muted?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${muted ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-slate-200 bg-white'}`}>
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">{title}</h4>
      <dl className="grid gap-2">
        {data.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[92px_1fr] gap-3">
            <dt className="text-slate-400">{label}</dt>
            <dd className="font-medium text-slate-700">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ManualEditor({
  users,
  state,
  setState,
  toggleParticipant,
  updateSplitValue,
  onCancel,
  onSubmit,
  busy,
}: {
  users: UserItem[];
  state: EditState;
  setState: (value: EditState | ((current: EditState | null) => EditState | null)) => void;
  toggleParticipant: (name: string) => void;
  updateSplitValue: (name: string, value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10';
  const update = (patch: Partial<EditState>) => setState((current) => current ? { ...current, ...patch } : current);
  const needsValues = !state.isSettlement && state.splitType !== 'equal';

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <div className="mb-4 flex items-center justify-between border-b border-indigo-100 pb-3">
        <h4 className="flex items-center gap-2 text-sm font-bold text-indigo-800">
          <Users className="h-4 w-4" />
          Manual Resolver
        </h4>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Payer
          <select value={state.paidBy} onChange={(e) => update({ paidBy: e.target.value })} className={input}>
            <option value="">Select payer</option>
            {users.map((user) => <option key={user.id} value={user.name}>{user.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Amount
          <input value={state.amount} onChange={(e) => update({ amount: e.target.value })} className={input} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Date
          <input type="date" value={state.date} onChange={(e) => update({ date: e.target.value })} className={input} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Currency
          <select value={state.currency} onChange={(e) => update({ currency: e.target.value })} className={input}>
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          USD to INR Rate
          <input
            value={state.exchangeRate}
            onChange={(e) => update({ exchangeRate: e.target.value })}
            disabled={state.currency !== 'USD'}
            placeholder={state.currency === 'USD' ? 'Leave blank for latest rate' : 'INR rows use 1.0'}
            className={input}
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Split Type
          <select value={state.splitType} onChange={(e) => update({ splitType: e.target.value as EditState['splitType'] })} className={input}>
            <option value="equal">Equal</option>
            <option value="unequal">Unequal Amounts</option>
            <option value="percentage">Percentages</option>
            <option value="share">Shares</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600 lg:col-span-2">
          Description
          <input value={state.description} onChange={(e) => update({ description: e.target.value })} className={input} />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={state.isSettlement} onChange={(e) => update({ isSettlement: e.target.checked })} />
          Record as settlement
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-indigo-100 bg-white p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
          {state.isSettlement ? 'Receiver' : 'Participants'}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {users.map((user) => {
            const selected = state.splitWith.includes(user.name);
            return (
              <div key={user.id} className={`rounded-lg border p-3 ${selected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input
                    type={state.isSettlement ? 'radio' : 'checkbox'}
                    checked={selected}
                    onChange={() => state.isSettlement ? update({ splitWith: [user.name] }) : toggleParticipant(user.name)}
                  />
                  {user.name}
                </label>
                {selected && needsValues && (
                  <input
                    value={state.splitValues[user.name] || ''}
                    onChange={(e) => updateSplitValue(user.name, e.target.value)}
                    placeholder={state.splitType === 'percentage' ? '%' : state.splitType === 'share' ? 'shares' : 'amount'}
                    className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-indigo-500"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <label className="mt-4 block space-y-1 text-xs font-semibold text-slate-600">
        Notes
        <input value={state.notes} onChange={(e) => update({ notes: e.target.value })} className={input} />
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
          Cancel
        </button>
        <button onClick={onSubmit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:bg-slate-300">
          {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Commit Resolution
        </button>
      </div>
    </div>
  );
}

function rowToResolvedData(row: RawData): ResolvedData {
  const splitWith = (row.split_with || '')
    .split(';')
    .map((item) => normalizeClientName(item))
    .filter(Boolean);
  const splitType = ['equal', 'unequal', 'percentage', 'share'].includes((row.split_type || '').toLowerCase())
    ? row.split_type.toLowerCase() as ResolvedData['splitType']
    : 'equal';
  const description = row.description || '';
  const notes = row.notes || '';
  return {
    date: normalizeDateForInput(row.date),
    description,
    paidBy: normalizeClientName(row.paid_by || ''),
    amount: Number(String(row.amount || '0').replace(/["',]/g, '')) || 0,
    currency: (row.currency || 'INR').toUpperCase(),
    splitType,
    splitWith,
    splitDetails: row.split_details || '',
    notes,
    isSettlement: !row.split_type || description.toLowerCase().includes('paid back') || description.toLowerCase().includes('deposit') || notes.toLowerCase().includes('settlement'),
  };
}

function normalizeClientName(value: string) {
  const clean = value.trim().toLowerCase();
  if (!clean) return '';
  if (clean === 'priya s' || clean === 'priyas') return 'Priya';
  if (clean === 'rohan') return 'Rohan';
  if (clean.includes('kabir')) return 'Kabir';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function normalizeDateForInput(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const monthMap: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const text = value.match(/^([A-Za-z]{3,})-(\d{1,2})$/);
  if (text) return `2026-${monthMap[text[1].toLowerCase().slice(0, 3)] || '03'}-${text[2].padStart(2, '0')}`;
  if (value === '04-05-2026') return '2026-04-05';
  const numeric = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  return value;
}

function parseSplitValues(details: string) {
  const result: Record<string, string> = {};
  for (const part of (details || '').split(';')) {
    const match = part.trim().match(/^(.+?)\s+(-?[\d.]+)%?$/);
    if (match) result[normalizeClientName(match[1])] = match[2];
  }
  return result;
}

function buildSplitDetails(state: EditState) {
  if (state.isSettlement || state.splitType === 'equal') return '';
  const suffix = state.splitType === 'percentage' ? '%' : '';
  return state.splitWith
    .map((name) => `${name} ${state.splitValues[name] || '0'}${suffix}`)
    .join('; ');
}
