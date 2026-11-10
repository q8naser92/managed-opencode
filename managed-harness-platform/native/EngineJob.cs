using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

// Start suspended so every managed child belongs to the job before it can run.
// Closing the owning desktop process closes the job and terminates its process tree.
sealed class EngineJob : IDisposable {
    IntPtr job, process;
    public int ProcessId { get; private set; }
    StreamReader output;
    public EngineJob(string executable, string arguments, string directory, IDictionary<string,string> environment) {
        job=CreateJobObject(IntPtr.Zero,null);
        if(job==IntPtr.Zero) throw new Win32Exception();
        try {
            var limits=new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();limits.BasicLimitInformation.LimitFlags=0x2000;
            if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits))) throw new Win32Exception();
            var keys=new List<string>(environment.Keys);keys.Sort(StringComparer.OrdinalIgnoreCase);
            var block=new StringBuilder();foreach(string key in keys) block.Append(key).Append('=').Append(environment[key]).Append('\0');block.Append('\0');
            IntPtr env=IntPtr.Zero;
            var pipe=new AnonymousPipeServerStream(PipeDirection.In,HandleInheritability.Inheritable);
            output=new StreamReader(pipe,Encoding.UTF8);
            var attributes=new SECURITY_ATTRIBUTES{nLength=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),bInheritHandle=true};
            IntPtr input=CreateFile("NUL",0x80000000,3,ref attributes,3,0,IntPtr.Zero);
            if(input==new IntPtr(-1))throw new Win32Exception();
            var startup=new STARTUPINFO();startup.cb=Marshal.SizeOf(startup);startup.dwFlags=0x100;startup.hStdInput=input;startup.hStdOutput=pipe.ClientSafePipeHandle.DangerousGetHandle();startup.hStdError=startup.hStdOutput;var child=new PROCESS_INFORMATION();
            try {
                env=Marshal.StringToHGlobalUni(block.ToString());
                if(!CreateProcess(executable,new StringBuilder("\""+executable+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,true,0x00000004|0x00000400|0x08000000,env,directory,ref startup,out child)) throw new Win32Exception();
                process=child.hProcess;ProcessId=child.dwProcessId;
                if(!AssignProcessToJobObject(job,process)) {TerminateProcess(process,1);throw new Win32Exception();}
                if(ResumeThread(child.hThread)==0xffffffff) {TerminateProcess(process,1);throw new Win32Exception();}
            } finally {if(env!=IntPtr.Zero)Marshal.FreeHGlobal(env);CloseHandle(input);pipe.DisposeLocalCopyOfClientHandle();if(child.hThread!=IntPtr.Zero)CloseHandle(child.hThread);}
        } catch {Dispose();throw;}
    }
    public bool Running { get {return process!=IntPtr.Zero && WaitForSingleObject(process,0)==258;} }
    public async Task<string> ListeningOrigin(){
        var deadline=Task.Delay(TimeSpan.FromSeconds(45));
        while(true){
            var line=output.ReadLineAsync();if(await Task.WhenAny(line,deadline)!=line)throw new TimeoutException("OpenCode startup timed out");
            string value=await line;if(value==null)throw new InvalidOperationException("OpenCode stopped before opening its local connection.");
            const string prefix="server listening on ";if(!value.StartsWith(prefix,StringComparison.Ordinal))continue;
            Uri address;if(!Uri.TryCreate(value.Substring(prefix.Length),UriKind.Absolute,out address)||address.Scheme!="http"||address.Host!="127.0.0.1"||address.Port<=0||address.AbsolutePath!="/"||address.Query!=""||address.Fragment!=""||address.UserInfo!="")throw new InvalidOperationException("Invalid local engine address");
            DrainOutput(output);return address.GetLeftPart(UriPartial.Authority);
        }
    }
    public void Drain(){DrainOutput(output);}
    static async void DrainOutput(StreamReader reader){try{while(await reader.ReadLineAsync()!=null){}}catch(ObjectDisposedException){}catch(IOException){}}
    public void Dispose(){if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}if(process!=IntPtr.Zero){CloseHandle(process);process=IntPtr.Zero;}if(output!=null){output.Dispose();output=null;}}
    [StructLayout(LayoutKind.Sequential)]struct SECURITY_ATTRIBUTES{public int nLength;public IntPtr lpSecurityDescriptor;[MarshalAs(UnmanagedType.Bool)]public bool bInheritHandle;}
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct STARTUPINFO{public int cb;public string lpReserved,lpDesktop,lpTitle;public int dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags;public short wShowWindow,cbReserved2;public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError;}
    [StructLayout(LayoutKind.Sequential)]struct PROCESS_INFORMATION{public IntPtr hProcess,hThread;public int dwProcessId,dwThreadId;}
    [StructLayout(LayoutKind.Sequential)]struct JOBOBJECT_BASIC_LIMIT_INFORMATION{public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
    [StructLayout(LayoutKind.Sequential)]struct IO_COUNTERS{public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}
    [StructLayout(LayoutKind.Sequential)]struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION{public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;public IO_COUNTERS IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inheritHandles,uint flags,IntPtr environment,string directory,ref STARTUPINFO startup,out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateFile(string name,uint access,uint share,ref SECURITY_ATTRIBUTES attributes,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr job,int kind,ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,uint length);
    [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")]static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")]static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll")]static extern bool TerminateProcess(IntPtr process,uint exitCode);
    [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
}
