using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;

sealed class ManagedService : ServiceBase {
    EngineJob child;
    readonly object lifecycle=new object();
    System.Threading.Timer watch;
    static readonly string DataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ManagedOpenCodeCentral", "Server");
    static readonly byte[] Entropy = Encoding.UTF8.GetBytes("ManagedOpenCodeCentral/vault/v1");
    static int Main(string[] args) {
        try {
            if (args.Length == 1 && args[0] == "init-key") {
                if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) throw new UnauthorizedAccessException();
                string path = Path.Combine(DataRoot, "vault-key.dpapi");
                byte[] key = new byte[32];
                using (var random = RandomNumberGenerator.Create()) random.GetBytes(key);
                using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                    byte[] encrypted = ProtectedData.Protect(key, Entropy, DataProtectionScope.LocalMachine);
                    output.Write(encrypted, 0, encrypted.Length);
                }
                Array.Clear(key, 0, key.Length);
                return 0;
            }
            if (args.Length == 1 && args[0] == "read-key") {
                byte[] key = ProtectedData.Unprotect(File.ReadAllBytes(Path.Combine(DataRoot, "vault-key.dpapi")), Entropy, DataProtectionScope.LocalMachine);
                Console.Write(Convert.ToBase64String(key));
                Array.Clear(key, 0, key.Length);
                return 0;
            }
            if (args.Length != 0) return 2;
            ServiceBase.Run(new ManagedService());
            return 0;
        } catch (Exception error) { Console.Error.WriteLine("Managed service failure: " + error.GetType().Name); return 1; }
    }
    ManagedService() { ServiceName = "ManagedOpenCodeServer"; CanStop = true; AutoLog = true; }
    protected override void OnStart(string[] args) {
        string executable = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "managed-server.exe");
        var env=new System.Collections.Generic.Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        foreach(System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())env[(string)entry.Key]=(string)entry.Value;
        foreach(string name in new[]{"BUN_BE_BUN","BUN_OPTIONS","NODE_OPTIONS","NODE_TLS_REJECT_UNAUTHORIZED","NODE_EXTRA_CA_CERTS","HTTP_PROXY","HTTPS_PROXY","ALL_PROXY"})env.Remove(name);
        lock(lifecycle){stopping=false;child=new EngineJob(executable,"",DataRoot,env);child.Drain();
            watch=new System.Threading.Timer(delegate{lock(lifecycle){if(!stopping&&child!=null&&!child.Running)Environment.Exit(1);}},null,1000,1000);}
    }
    bool stopping;
    protected override void OnStop() {
        lock(lifecycle){stopping = true;
            if(watch!=null){watch.Dispose();watch=null;}
            if(child!=null){child.Dispose();child=null;}}
    }
}
