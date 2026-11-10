using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

// Production authentication methods, with delayed transport replies to reproduce overlapping login/logout.
static class NativeAuthenticationTests {
    static Type type;static Form form;static int count;
    [STAThread] static int Main(string[] args){try{Run(args[0]);Console.WriteLine("Native authentication: "+count+" checks passed.");return 0;}catch(Exception error){Console.Error.WriteLine(error);return 1;}}
    static void Run(string file){
        type=Assembly.LoadFrom(file).GetType("ManagedClient",true);using(form=(Form)Activator.CreateInstance(type,true)){
            var handler=new AuthTransport();using(var http=new HttpClient(handler)){
                Set("origin","https://management.test");Set("remote",http);
                handler.DelayStart=true;var saml=Call("Login");PumpUntil(()=>handler.StartSeen);
                Check(!Button("signIn").Enabled&&!Button("emailSignIn").Enabled,"Both methods must be disabled while SAML starts");
                Check(Button("signOut").Enabled&&Button("signOut").Text=="Cancel sign-in","Pending sign-in must be cancellable");
                Pump(Call("EmailLogin"));Check(handler.EmailRequests==0,"Email cannot overlap a pending SAML attempt");
                Pump(Call("Logout"));handler.StartRelease.SetResult(true);ExpectCancelled(saml);
                Check(Get("token")==null&&Get("userID")==null,"Late SAML start cannot undo logout");
                Check(Get("signInListener")==null,"Logout closes the pending loopback listener");
                handler.DelayMe=true;int attempt=(int)Invoke("BeginAuthentication");var exchange=Call("CompleteAuthentication",attempt,"candidate-token");PumpUntil(()=>handler.MeSeen);
                Pump(Call("Logout"));handler.MeRelease.SetResult(true);ExpectCancelled(exchange);
                Check(Get("token")==null&&Get("userID")==null&&Get("sessionID")==null,"Late identity response cannot repopulate a signed-out client");
                handler.DelayMe=false;attempt=(int)Invoke("BeginAuthentication");
                Set("userID","previous-user");Set("sessionID","previous-session");((RichTextBox)Get("transcript")).Text="previous-user-content";
                var jobType=type.Assembly.GetType("EngineJob",true);var environment=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);foreach(System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())environment[(string)entry.Key]=(string)entry.Value;
                var job=Activator.CreateInstance(jobType,BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic,null,new object[]{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"cmd.exe"),"/d /c ping -n 30 127.0.0.1",Path.GetTempPath(),environment},null);
                int pid=(int)jobType.GetProperty("ProcessId").GetValue(job,null);Set("engine",job);
                Pump(Call("CompleteAuthentication",attempt,"new-token"));Invoke("EndAuthentication",attempt);
                Check((string)Get("token")=="new-token"&&(string)Get("userID")=="new-user","Verified identity is adopted");
                Check(Get("engine")==null&&Get("sessionID")==null,"Every identity adoption resets previous engine and session");
                PumpUntil(()=>!Alive(pid));Check(!Alive(pid),"Previous engine process is terminated");
                Check(((RichTextBox)Get("transcript")).TextLength==0,"Previous user's conversation is cleared");
                Check((int)Invoke("BeginAuthentication")==0,"Signed-in user cannot start an overlapping account switch");
                Pump(Call("Logout"));Check(Button("signIn").Enabled&&Button("emailSignIn").Enabled,"Both methods become available after logout");
            }
        }
    }
    sealed class AuthTransport:HttpMessageHandler{
        internal bool DelayStart,StartSeen,DelayMe,MeSeen;internal int EmailRequests;
        internal readonly TaskCompletionSource<bool> StartRelease=new TaskCompletionSource<bool>(),MeRelease=new TaskCompletionSource<bool>();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token){
            string path=request.RequestUri.AbsolutePath;string body="{}";
            if(path=="/auth/desktop/start"){StartSeen=true;if(DelayStart)await StartRelease.Task;body="{\"url\":\"https://management.test/auth/desktop/continue?ticket=fixture\"}";}
            else if(path.StartsWith("/auth/email/")){EmailRequests++;throw new Exception("Unexpected overlapping email request");}
            else if(path=="/api/me"){MeSeen=true;if(DelayMe)await MeRelease.Task;body="{\"id\":\"new-user\"}";}
            else if(path=="/api/catalog")body="{\"revision\":1,\"models\":[{\"id\":\"approved\",\"name\":\"Approved model\"}],\"connectors\":[]}";
            else if(path=="/api/actions/pending")body="[]";
            return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(body)};
        }
    }
    static object Invoke(string name,params object[] args){return type.GetMethod(name,BindingFlags.Instance|BindingFlags.NonPublic).Invoke(form,args);}
    static Task Call(string name,params object[] args){return (Task)Invoke(name,args);}
    static object Get(string name){return type.GetField(name,BindingFlags.Instance|BindingFlags.NonPublic).GetValue(form);}
    static void Set(string name,object value){type.GetField(name,BindingFlags.Instance|BindingFlags.NonPublic).SetValue(form,value);}
    static Button Button(string name){return (Button)Get(name);}
    static void PumpUntil(Func<bool> condition){var end=DateTime.UtcNow.AddSeconds(15);while(!condition()){if(DateTime.UtcNow>end)throw new TimeoutException();Application.DoEvents();Thread.Sleep(10);}}
    static void Pump(Task task){PumpUntil(()=>task.IsCompleted);task.GetAwaiter().GetResult();}
    static void ExpectCancelled(Task task){PumpUntil(()=>task.IsCompleted);try{task.GetAwaiter().GetResult();throw new Exception("A stale authentication completed");}catch(OperationCanceledException){count++;}}
    static bool Alive(int pid){try{using(var p=Process.GetProcessById(pid))return !p.HasExited;}catch(ArgumentException){return false;}}
    static void Check(bool pass,string message){if(!pass)throw new Exception(message);count++;}
}
