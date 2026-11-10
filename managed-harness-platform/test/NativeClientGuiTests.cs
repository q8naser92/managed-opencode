using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Drives the installed WinForms assembly in the standard user's Windows session.
// No authentication or policy is mocked. A transport gate only delays engine-grant replies for race tests.
static class NativeClientGuiTests {
    static readonly string Root="C:\\HarnessLab\\clients\\A";
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static readonly Dictionary<string,bool> Checks=new Dictionary<string,bool>();
    static Form form;static Type type;static IDictionary<string,object> fixture;
    static int exit=1;static string phase="startup";static bool cached;
    static readonly HttpClient Mail=new HttpClient(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(5)};
    [STAThread] static int Main(string[] args){
        cached=Array.IndexOf(args,"--cached")>=0;
        ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        try{
            fixture=Map(Json.DeserializeObject(File.ReadAllText(Path.Combine(Root,"central-fixture.json"))));
            type=Assembly.LoadFrom("C:\\Program Files\\ManagedOpenCodeCentral\\Client\\ManagedOpenCode.exe").GetType("ManagedClient",true);
            form=(Form)Activator.CreateInstance(type,true);
            var progress=new System.Windows.Forms.Timer{Interval=1000};progress.Tick+=delegate{File.WriteAllText(Path.Combine(Root,"native-client-gui-progress.json"),Json.Serialize(new{phase,status=((Label)Get("status")).Text,submitting=Get("submitting"),starting=Get("starting"),epoch=Get("workEpoch"),session=Get("sessionID"),enginePid=Get("engine")==null?0:EnginePid(),dialogs=Application.OpenForms.Cast<Form>().Select(f=>f.Text).ToArray()}));};progress.Start();
            form.Shown+=async delegate{Exception failure=null;try{await Run();exit=0;}catch(Exception error){failure=error;}if(failure!=null){await CaptureFailure();Save(false,failure.GetType().Name+": "+failure.Message);}form.Close();};
            Application.Run(form);return exit;
        }catch(Exception error){Save(false,error.GetType().Name+": "+error.Message);return 1;}
    }
    static async Task Run(){
        Check("standardWindowsUser",Environment.UserName=="HarnessUserA"&&!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator));
        phase="email login";
        if(cached){var saved=Map(Json.DeserializeObject(File.ReadAllText(Path.Combine(Root,"central-test-session.json"))));Set("token",saved["token"]);var task=(Task<object>)type.GetMethod("Api",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(form,new object[]{"/api/me","GET",null,false});var me=Map(await task);Set("userID",me["id"]);await Call("RefreshState");}
        else{long since=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();var email=FillDialog("Email sign-in",()=>Task.FromResult((string)fixture["email"]));var code=FillDialog("Check your email",async()=>await Code(since));await Call("EmailLogin");await email;await code;}
        Check(cached?"cachedDesktopSessionAuthenticated":"nativeEmailOtpLogin",Get("token")!=null&&Get("userID")!=null&&(bool)Get("online"));
        Check("approvedModelsLoaded",((ComboBox)Get("models")).Items.Count>0);
        phase="personal key";var key=FillDialog("Your personal API key",()=>Task.FromResult((string)fixture["key"]));await Call("EnrollKey");await key;
        Check("nativePersonalKeyEnrollment",((Label)Get("status")).Text=="Personal key saved.");
        string workspace=Path.Combine(Root,"central-workspace");Directory.CreateDirectory(workspace);File.WriteAllText(Path.Combine(workspace,"sample.txt"),"CENTRAL_READ_CANARY");
        Set("workspace",workspace);((Label)Get("folderLabel")).Text=workspace;
        phase="model round trip";var approved=AnswerRead(true);((TextBox)Get("prompt")).Text="TESTCASE:central_read_user_a";Button("send").PerformClick();
        await Until(()=>((RichTextBox)Get("transcript")).Text.Contains("OBSERVED_TOOL_RESULT")&&((RichTextBox)Get("transcript")).Text.Contains("CENTRAL_READ_CANARY"),90000);
        await approved;Check("nativeCentralAskApproval",true);Check("nativeModelLocalReadTranscript",true);Check("realInstalledEngine",Get("engine")!=null&&Get("sessionID")!=null);
        using(var bitmap=new Bitmap(form.Width,form.Height)){using(var graphics=Graphics.FromImage(bitmap))graphics.CopyFromScreen(form.Location,Point.Empty,form.Size);bitmap.Save(Path.Combine(Root,"native-client-gui.png"));}
        int pid=EnginePid();Button("stop").PerformClick();await Until(()=>!Alive(pid),5000);
        Check("stopButtonTerminatesEngine",Get("engine")==null&&!Button("stop").Enabled);
        Button("newSession").PerformClick();Check("newSessionClearsConversation",Get("sessionID")==null&&((RichTextBox)Get("transcript")).TextLength==0);
        phase="central ask rejection";var declined=AnswerRead(false);((TextBox)Get("prompt")).Text="TESTCASE:central_read_user_a";Button("send").PerformClick();
        await Until(()=>((RichTextBox)Get("transcript")).Text.Contains("Central policy did not authorize"),60000);await declined;
        Check("nativeCentralAskRejection",!((RichTextBox)Get("transcript")).Text.Contains("CENTRAL_READ_CANARY"));
        Button("newSession").PerformClick();string other=Path.Combine(Root,"native-gui-other-workspace");Directory.CreateDirectory(other);Set("workspace",other);((Label)Get("folderLabel")).Text=other;
        phase="outside workspace denial";((TextBox)Get("prompt")).Text="TESTCASE:central_read_user_a";Button("send").PerformClick();
        await Until(()=>((RichTextBox)Get("transcript")).Text.Contains("outside the selected workspace"),60000);
        Check("outsideWorkspaceErrorVisible",!((RichTextBox)Get("transcript")).Text.Contains("CENTRAL_READ_CANARY"));
        Button("newSession").PerformClick();Set("workspace",workspace);((Label)Get("folderLabel")).Text=workspace;
        var original=(HttpClient)Get("remote");var handler=new Gate();var gated=new HttpClient(handler){Timeout=TimeSpan.FromSeconds(10)};Set("remote",gated);
        try{
            foreach(string cancel in new[]{"newSession","stop"}){
                phase="pending grant "+cancel;handler.Arm();((TextBox)Get("prompt")).Text="Must not be submitted";Button("send").PerformClick();await Until(()=>handler.Seen.Task.IsCompleted,15000);
                Check(cancel+"AvailableDuringStartup",Button(cancel).Enabled);Button(cancel).PerformClick();handler.Release.TrySetResult(true);
                await Until(()=>!(bool)Get("submitting"),10000);
                Check(cancel+"CancelsPendingEngineGrant",Get("engine")==null&&Get("sessionID")==null&&((TextBox)Get("prompt")).Text=="Must not be submitted");
            }
            phase="startup error";handler.Fail=true;((TextBox)Get("prompt")).Text="A failed startup must remain visible";Button("send").PerformClick();await Until(()=>!(bool)Get("submitting"),10000);
            Check("startupErrorVisible",Get("engine")==null&&((Label)Get("status")).Text.StartsWith("Request failed."));
        }finally{Set("remote",original);gated.Dispose();}
        phase="sign out";await Call("Logout");Check("nativeSignOutClearsAccess",Get("token")==null&&Get("userID")==null&&Get("sessionID")==null&&!Button("send").Enabled);
        Save(true,"");
    }
    static async Task FillDialog(string title,Func<Task<string>> value){
        Form dialog=null;await Until(()=>{dialog=Application.OpenForms.Cast<Form>().FirstOrDefault(f=>f!=form&&f.Text==title);return dialog!=null;},20000);
        try{var box=dialog.Controls.OfType<TextBox>().Single();box.Text=await value();((Button)dialog.AcceptButton).PerformClick();}catch{dialog.Close();throw;}
    }
    static async Task AnswerRead(bool allow){
        IntPtr dialog=IntPtr.Zero;uint thread=GetCurrentThreadId();
        await Until(()=>{EnumThreadWindows(thread,delegate(IntPtr window,IntPtr unused){var text=new System.Text.StringBuilder(256);GetWindowText(window,text,256);if(text.ToString()=="Approve read?"){dialog=window;return false;}return true;},IntPtr.Zero);return dialog!=IntPtr.Zero;},60000);
        SendMessage(dialog,0x0111,new IntPtr(allow?6:7),IntPtr.Zero);
    }
    delegate bool WindowCallback(IntPtr window,IntPtr parameter);
    [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]static extern bool EnumThreadWindows(uint thread,WindowCallback callback,IntPtr parameter);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr window,System.Text.StringBuilder text,int maximum);
    [DllImport("user32.dll")]static extern IntPtr SendMessage(IntPtr window,uint message,IntPtr wparam,IntPtr lparam);
    static async Task CaptureFailure(){
        try{using(var bitmap=new Bitmap(form.Width,form.Height)){using(var graphics=Graphics.FromImage(bitmap))graphics.CopyFromScreen(form.Location,Point.Empty,form.Size);bitmap.Save(Path.Combine(Root,"native-client-gui-failure.png"));}
            if(Get("sessionID")!=null&&Get("local")!=null){var call=(Task)type.GetMethod("Local",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(form,new object[]{"/api/session/"+Get("sessionID")+"/message?limit=200&order=asc","GET",null});await call;File.WriteAllText(Path.Combine(Root,"native-client-gui-messages.json"),Json.Serialize(call.GetType().GetProperty("Result").GetValue(call,null)));}
        }catch{}
    }
    static async Task<string> Code(long since){
        for(int n=0;n<60;n++){
            using(var request=new HttpRequestMessage(HttpMethod.Get,((string)fixture["mailOrigin"]).TrimEnd('/')+"/?email="+Uri.EscapeDataString((string)fixture["email"]))){request.Headers.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer",(string)fixture["mailToken"]);using(var response=await Mail.SendAsync(request)){response.EnsureSuccessStatusCode();var data=Map(Json.DeserializeObject(await response.Content.ReadAsStringAsync()));foreach(var item in (object[])data["messages"]){var message=Map(item);if(Convert.ToInt64(message["at"])>=since)return (string)message["code"];}}}
            await Task.Delay(250);
        }throw new TimeoutException("No fresh OTP reached the lab mailbox");
    }
    sealed class Gate:DelegatingHandler{
        internal bool Armed,Fail;internal TaskCompletionSource<bool> Seen,Release;
        internal Gate():base(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false}){}
        internal void Arm(){Armed=true;Seen=new TaskCompletionSource<bool>();Release=new TaskCompletionSource<bool>();}
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancel){
            if(request.RequestUri.AbsolutePath=="/api/engine"){
                if(Fail)return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable){Content=new StringContent("Unavailable")};
                if(Armed){Armed=false;var result=await base.SendAsync(request,cancel);Seen.TrySetResult(true);await Release.Task;return result;}
            }return await base.SendAsync(request,cancel);
        }
    }
    static async Task Until(Func<bool> condition,int timeout){var end=DateTime.UtcNow.AddMilliseconds(timeout);while(!condition()){if(DateTime.UtcNow>end)throw new TimeoutException("Timed out: "+phase);await Task.Delay(100);}}
    static Task Call(string name){return (Task)type.GetMethod(name,BindingFlags.Instance|BindingFlags.NonPublic).Invoke(form,null);}
    static object Get(string name){return type.GetField(name,BindingFlags.Instance|BindingFlags.NonPublic).GetValue(form);}
    static void Set(string name,object value){type.GetField(name,BindingFlags.Instance|BindingFlags.NonPublic).SetValue(form,value);}
    static Button Button(string name){return (Button)Get(name);}
    static int EnginePid(){var engine=Get("engine");return (int)engine.GetType().GetProperty("ProcessId").GetValue(engine,null);}
    static bool Alive(int pid){try{using(var p=Process.GetProcessById(pid))return !p.HasExited;}catch(ArgumentException){return false;}}
    static IDictionary<string,object> Map(object value){return (IDictionary<string,object>)value;}
    static void Check(string name,bool value){Checks[name]=value;if(!value)throw new Exception("Assertion failed: "+name);}
    static void Save(bool pass,string error){File.WriteAllText(Path.Combine(Root,"native-client-gui-result.json"),Json.Serialize(new{pass,user=Environment.UserName,phase,checks=Checks,error,freshEmailLogin=!cached,workspaceSelectedByTest=true,pendingGrantTransportDelayed=true}));}
}
